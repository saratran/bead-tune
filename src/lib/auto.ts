/**
 * "Auto" mode: tries many combinations of look settings, scores each pattern,
 * and picks a varied handful of suggestions.
 *
 * Scoring compares each pattern with the *unadjusted* source image sampled on
 * the same grid, so changing brightness/contrast/saturation only wins when it
 * makes the beads look more like the original.
 */
import { deltaE2000, labDistSq, rgbToLab, type ColorMetric, type Lab } from "./color";
import type { DitherMode, Pattern } from "./pattern";
import { buildPattern, type PipelineSettings } from "./pipeline";
import { sampleGrid, type ImageSource } from "./sampling";

// ---------------------------------------------------------------- search space

export interface DitherChoice {
  mode: DitherMode;
  strength: number;
}

/** Which values to try for each setting. Every list needs at least one entry. */
export interface SearchSpace {
  sampling: ("smooth" | "sharp")[];
  denoise: boolean[];
  maxColors: number[];
  dither: DitherChoice[];
  cleanup: number[];
  metric: ColorMetric[];
  minBeads: number[];
  brightness: number[];
  contrast: number[];
  saturation: number[];
}

export const DEFAULT_SEARCH_SPACE: SearchSpace = {
  sampling: ["smooth", "sharp"],
  denoise: [false],
  maxColors: [12, 24, 40, 64],
  dither: [
    { mode: "none", strength: 0 },
    { mode: "diffusion", strength: 60 },
  ],
  cleanup: [0, 1],
  metric: ["standard"],
  minBeads: [0],
  brightness: [0],
  contrast: [0, 15],
  saturation: [0, 20],
};

/** The values the configuration UI offers for each setting. */
export const SEARCH_OPTIONS = {
  maxColors: [6, 8, 12, 16, 24, 32, 40, 48, 64, 80, 100, 120],
  dither: [
    { mode: "none", strength: 0 },
    { mode: "diffusion", strength: 40 },
    { mode: "diffusion", strength: 60 },
    { mode: "diffusion", strength: 85 },
    { mode: "ordered", strength: 40 },
    { mode: "ordered", strength: 70 },
  ] as DitherChoice[],
  cleanup: [0, 1, 2, 3],
  minBeads: [0, 3, 6, 10],
  brightness: [-20, -10, 0, 10, 20],
  contrast: [-10, 0, 15, 30],
  saturation: [-20, 0, 20, 40],
};

export interface Candidate {
  sampling: "smooth" | "sharp";
  denoise: boolean;
  maxColors: number;
  dither: DitherChoice;
  cleanup: number;
  metric: ColorMetric;
  minBeads: number;
  brightness: number;
  contrast: number;
  saturation: number;
}

export function countCombinations(space: SearchSpace): number {
  return Object.values(space).reduce((n, list) => n * Math.max(1, list.length), 1);
}

/**
 * All combinations, or an evenly spread subset of `limit` of them. The subset
 * walks the full list with a stride coprime to its length, so every value of
 * every setting still shows up.
 */
export function enumerateCandidates(space: SearchSpace, limit = Infinity): Candidate[] {
  const keys = Object.keys(space) as (keyof SearchSpace)[];
  const lists = keys.map((k) => (space[k].length ? space[k] : [undefined]) as unknown[]);
  const total = lists.reduce((n, l) => n * l.length, 1);
  const at = (i: number): Candidate => {
    const c: Record<string, unknown> = {};
    for (let k = lists.length - 1; k >= 0; k--) {
      const l = lists[k]!;
      c[keys[k]!] = l[i % l.length];
      i = Math.floor(i / l.length);
    }
    return c as unknown as Candidate;
  };
  if (total <= limit) return Array.from({ length: total }, (_, i) => at(i));
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  // Golden-ratio stride spreads picks evenly through the combinations.
  let stride = Math.max(1, Math.round(total * 0.618) % total) | 1;
  while (gcd(stride, total) !== 1) stride++;
  return Array.from({ length: limit }, (_, i) => at((i * stride) % total));
}

export function candidateSettings(base: PipelineSettings, c: Candidate): PipelineSettings {
  return {
    ...base,
    sampling: c.sampling,
    denoise: c.denoise,
    cleanup: c.cleanup,
    options: {
      ...base.options,
      maxColors: c.maxColors,
      minBeads: c.minBeads,
      metric: c.metric,
      dither: c.dither.mode,
      ditherStrength: c.dither.strength,
      adjustments: { brightness: c.brightness, contrast: c.contrast, saturation: c.saturation },
    },
  };
}

// ---------------------------------------------------------------- scoring

export interface Metrics {
  /** Mean ΔE2000 between each bead and the original at that spot. */
  colorError: number;
  /** Mean ΔE2000 where the original has the most detail (eyes, outlines, highlights). */
  detailError: number;
  /** Mean ΔE after blurring both — how it looks from a distance (credits dithering). */
  distanceError: number;
  /** 1 − correlation of edge strength: are outlines/features where the original has them? */
  edgeError: number;
  /** Speckle the original doesn't have: mean extra bead-to-neighbourhood ΔE. */
  noise: number;
  colors: number;
  beads: number;
  /** Beads with no neighbour of the same colour. */
  strays: number;
  /** Same-colour connected areas per 100 beads (lower = easier to place). */
  fragmentation: number;
}

interface Grid {
  w: number;
  h: number;
  /** Lab per cell; NaN L means no data (empty bead or transparent original). */
  lab: Float32Array;
}

function labGridFromImage(img: ImageData): Grid {
  const n = img.width * img.height;
  const lab = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    if (img.data[i * 4 + 3]! < 128) {
      lab[i * 3] = NaN;
      continue;
    }
    const [L, a, b] = rgbToLab(img.data[i * 4]!, img.data[i * 4 + 1]!, img.data[i * 4 + 2]!);
    lab[i * 3] = L;
    lab[i * 3 + 1] = a;
    lab[i * 3 + 2] = b;
  }
  return { w: img.width, h: img.height, lab };
}

/** 3×3 binomial blur, ignoring cells without data. */
function blur(g: Grid): Grid {
  const out = new Float32Array(g.lab.length);
  const k = [1, 2, 1];
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const i = y * g.w + x;
      if (Number.isNaN(g.lab[i * 3]!)) {
        out[i * 3] = NaN;
        continue;
      }
      let L = 0, a = 0, b = 0, wsum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= g.w || yy >= g.h) continue;
          const j = yy * g.w + xx;
          if (Number.isNaN(g.lab[j * 3]!)) continue;
          const wgt = k[dx + 1]! * k[dy + 1]!;
          L += g.lab[j * 3]! * wgt;
          a += g.lab[j * 3 + 1]! * wgt;
          b += g.lab[j * 3 + 2]! * wgt;
          wsum += wgt;
        }
      }
      out[i * 3] = L / wsum;
      out[i * 3 + 1] = a / wsum;
      out[i * 3 + 2] = b / wsum;
    }
  }
  return { w: g.w, h: g.h, lab: out };
}

/** Sobel gradient magnitude of lightness; NaN where any neighbour lacks data. */
function edges(g: Grid): Float32Array {
  const out = new Float32Array(g.w * g.h).fill(NaN);
  const L = (x: number, y: number) => g.lab[(y * g.w + x) * 3]!;
  for (let y = 1; y < g.h - 1; y++) {
    for (let x = 1; x < g.w - 1; x++) {
      const gx = L(x + 1, y - 1) + 2 * L(x + 1, y) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x - 1, y) - L(x - 1, y + 1);
      const gy = L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x, y - 1) - L(x + 1, y - 1);
      out[y * g.w + x] = Math.hypot(gx, gy); // NaN propagates
    }
  }
  return out;
}

function correlation(a: Float32Array, b: Float32Array): number {
  let n = 0, sa = 0, sb = 0;
  for (let i = 0; i < a.length; i++) {
    if (Number.isNaN(a[i]!) || Number.isNaN(b[i]!)) continue;
    n++;
    sa += a[i]!;
    sb += b[i]!;
  }
  if (n < 2) return 1;
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < a.length; i++) {
    if (Number.isNaN(a[i]!) || Number.isNaN(b[i]!)) continue;
    const da = a[i]! - ma, db = b[i]! - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  return va === 0 || vb === 0 ? (va === vb ? 1 : 0) : cov / Math.sqrt(va * vb);
}

/**
 * Scores `pattern` against `reference` (the unadjusted original, smooth-sampled
 * on the pattern's grid). Pattern cell (x, y) ↔ reference cell (x − offsetX, y − offsetY).
 */
/** Share of cells (most detailed first) used for detailError. */
const DETAIL_SHARE = 0.15;

export function scorePattern(pattern: Pattern, reference: ImageData, offsetX = 0, offsetY = 0): Metrics {
  const { width: w, height: h } = pattern;
  const ref: Grid = { w, h, lab: new Float32Array(w * h * 3).fill(NaN) };
  const pat: Grid = { w, h, lab: new Float32Array(w * h * 3).fill(NaN) };
  const refFull = labGridFromImage(reference);
  let colorSum = 0;
  let compared = 0;
  const cellError = new Float32Array(w * h).fill(NaN);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const idx = pattern.cells[i]!;
      const rx = x - offsetX, ry = y - offsetY;
      const inRef = rx >= 0 && ry >= 0 && rx < refFull.w && ry < refFull.h && !Number.isNaN(refFull.lab[(ry * refFull.w + rx) * 3]!);
      if (inRef) ref.lab.set(refFull.lab.subarray((ry * refFull.w + rx) * 3, (ry * refFull.w + rx) * 3 + 3), i * 3);
      if (idx >= 0) pat.lab.set(pattern.colors[idx]!.lab, i * 3);
      if (idx >= 0 && inRef) {
        const e = deltaE2000(pattern.colors[idx]!.lab, [ref.lab[i * 3]!, ref.lab[i * 3 + 1]!, ref.lab[i * 3 + 2]!] as Lab);
        cellError[i] = e;
        colorSum += e;
        compared++;
      }
    }
  }

  const bp = blur(pat), br = blur(ref);
  let distSum = 0, distN = 0;
  for (let i = 0; i < w * h; i++) {
    if (Number.isNaN(bp.lab[i * 3]!) || Number.isNaN(br.lab[i * 3]!)) continue;
    distSum += Math.sqrt(labDistSq([bp.lab[i * 3]!, bp.lab[i * 3 + 1]!, bp.lab[i * 3 + 2]!], [br.lab[i * 3]!, br.lab[i * 3 + 1]!, br.lab[i * 3 + 2]!]));
    distN++;
  }

  // Edges on lightly blurred images: features count, single-bead dither speckle much less.
  const edgeError = 1 - correlation(edges(bp), edges(br));

  // Detail: the cells where the original differs most from its surroundings
  // (top DETAIL_SHARE). Small features like eyes barely move the overall mean.
  const saliency: { i: number; v: number }[] = [];
  for (let i = 0; i < w * h; i++) {
    if (Number.isNaN(cellError[i]!) || Number.isNaN(br.lab[i * 3]!)) continue;
    saliency.push({ i, v: labDistSq([ref.lab[i * 3]!, ref.lab[i * 3 + 1]!, ref.lab[i * 3 + 2]!], [br.lab[i * 3]!, br.lab[i * 3 + 1]!, br.lab[i * 3 + 2]!]) });
  }
  saliency.sort((a, b) => b.v - a.v);
  const detailCells = saliency.slice(0, Math.max(1, Math.round(saliency.length * DETAIL_SHARE)));
  const detailError = saliency.length ? detailCells.reduce((sum, c) => sum + cellError[c.i]!, 0) / detailCells.length : 0;

  // Speckle: how far each bead is from its blurred neighbourhood, beyond what the
  // original has at the same spot. Dithering a flat background scores badly here;
  // texture that's really in the original doesn't.
  let noiseSum = 0, noiseN = 0;
  for (let i = 0; i < w * h; i++) {
    if (Number.isNaN(pat.lab[i * 3]!) || Number.isNaN(ref.lab[i * 3]!) || Number.isNaN(bp.lab[i * 3]!) || Number.isNaN(br.lab[i * 3]!)) continue;
    const dev = (g: Grid, b: Grid) => Math.sqrt(labDistSq([g.lab[i * 3]!, g.lab[i * 3 + 1]!, g.lab[i * 3 + 2]!], [b.lab[i * 3]!, b.lab[i * 3 + 1]!, b.lab[i * 3 + 2]!]));
    noiseSum += Math.max(0, dev(pat, bp) - dev(ref, br));
    noiseN++;
  }

  let strays = 0;
  const seen = new Uint8Array(w * h);
  let regions = 0;
  for (let i = 0; i < w * h; i++) {
    const v = pattern.cells[i]!;
    if (v < 0) continue;
    const x = i % w, y = (i / w) | 0;
    const same = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < w && yy < h && pattern.cells[yy * w + xx] === v;
    if (!same(x - 1, y) && !same(x + 1, y) && !same(x, y - 1) && !same(x, y + 1)) strays++;
    if (seen[i]) continue;
    regions++;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      const jx = j % w, jy = (j / w) | 0;
      for (const [nx, ny] of [[jx - 1, jy], [jx + 1, jy], [jx, jy - 1], [jx, jy + 1]] as const) {
        const k = ny * w + nx;
        if (same(nx, ny) && !seen[k]) {
          seen[k] = 1;
          stack.push(k);
        }
      }
    }
  }

  return {
    colorError: compared ? colorSum / compared : 0,
    detailError,
    distanceError: distN ? distSum / distN : 0,
    edgeError,
    noise: noiseN ? noiseSum / noiseN : 0,
    colors: pattern.colors.length,
    beads: pattern.total,
    strays,
    fragmentation: pattern.total ? (regions / pattern.total) * 100 : 0,
  };
}

// ---------------------------------------------------------------- selection

/** Relative weights; tuned on real images (see scripts/tune-auto.ts). */
export const WEIGHTS = {
  likeness: { color: 0.25, detail: 0.25, distance: 0.2, edge: 0.1, noise: 0.2 },
  effort: { colors: 0.45, strays: 0.35, fragmentation: 0.2 },
};

export interface Scored {
  candidate: Candidate;
  pattern: Pattern;
  metrics: Metrics;
  /** 0–100 within this scan: how close to the original. */
  likeness: number;
  /** 0–100 within this scan: how easy to make (few colours, few strays, big areas). */
  ease: number;
  /** 0..1 within this scan: how many colours, on a log scale (0 = fewest). */
  colorLoad: number;
}

export interface Suggestion extends Scored {
  label: string;
  reason: string;
}

/** Normalises each metric to 0..1 across the scan (0 = best). */
function normaliser(values: number[]) {
  const lo = Math.min(...values), hi = Math.max(...values);
  return (v: number) => (hi > lo ? (v - lo) / (hi - lo) : 0);
}

export function rate(results: { candidate: Candidate; pattern: Pattern; metrics: Metrics }[]): Scored[] {
  const m = results.map((r) => r.metrics);
  const n = {
    color: normaliser(m.map((x) => x.colorError)),
    detail: normaliser(m.map((x) => x.detailError)),
    distance: normaliser(m.map((x) => x.distanceError)),
    edge: normaliser(m.map((x) => x.edgeError)),
    noise: normaliser(m.map((x) => x.noise)),
    // Log scale: going from 12 to 24 colours matters as much as 32 to 64.
    colors: normaliser(m.map((x) => Math.log(x.colors))),
    strays: normaliser(m.map((x) => x.strays / Math.max(1, x.beads))),
    fragmentation: normaliser(m.map((x) => x.fragmentation)),
  };
  const L = WEIGHTS.likeness, E = WEIGHTS.effort;
  return results.map((r) => {
    const x = r.metrics;
    const bad = L.color * n.color(x.colorError) + L.detail * n.detail(x.detailError) + L.distance * n.distance(x.distanceError) + L.edge * n.edge(x.edgeError) + L.noise * n.noise(x.noise);
    const effort = E.colors * n.colors(Math.log(x.colors)) + E.strays * n.strays(x.strays / Math.max(1, x.beads)) + E.fragmentation * n.fragmentation(x.fragmentation);
    return {
      ...r,
      likeness: Math.round((1 - bad) * 100),
      ease: Math.round((1 - effort) * 100),
      colorLoad: n.colors(Math.log(x.colors)),
    };
  });
}

/** Share of cells that differ between two patterns of the same size (1 if sizes differ). */
export function difference(a: Pattern, b: Pattern): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let diff = 0;
  for (let i = 0; i < a.cells.length; i++) {
    const ca = a.cells[i]!, cb = b.cells[i]!;
    if ((ca < 0) !== (cb < 0) || (ca >= 0 && a.colors[ca]!.id !== b.colors[cb]!.id)) diff++;
  }
  return diff / a.cells.length;
}

/** Candidates no other candidate beats on both likeness and ease, by likeness. */
export function paretoFront(scored: Scored[]): Scored[] {
  return scored
    .filter((s) => !scored.some((o) => o.likeness >= s.likeness && o.ease >= s.ease && (o.likeness > s.likeness || o.ease > s.ease)))
    .sort((a, b) => b.likeness - a.likeness);
}

/**
 * The "knee" of the likeness/ease trade-off: the front point furthest from the
 * straight line between the most faithful and the easiest candidate.
 */
export function knee(scored: Scored[]): Scored | undefined {
  const front = paretoFront(scored);
  if (front.length <= 2) return front[Math.floor(front.length / 2)];
  const a = front[0]!, b = front[front.length - 1]!;
  const dx = b.likeness - a.likeness, dy = b.ease - a.ease;
  const len = Math.hypot(dx, dy) || 1;
  let bestPoint = front[1]!, bestDist = -Infinity;
  for (const p of front.slice(1, -1)) {
    const dist = ((p.likeness - a.likeness) * dy - (p.ease - a.ease) * dx) / len;
    if (Math.abs(dist) > bestDist) {
      bestDist = Math.abs(dist);
      bestPoint = p;
    }
  }
  return bestPoint;
}

/** Below this share of differing beads, two suggestions count as duplicates. */
export const MIN_DIFFERENCE = 0.06;
/** Likeness points a pick gives up for using the most colours in the scan. */
export const COLOR_PENALTY = 6;
/** "Balanced" = fewest colours among candidates within this many likeness points of the best. */
export const BALANCED_WITHIN = 6;

/**
 * Picks up to `count` varied suggestions: named picks first (most faithful,
 * balanced, simplest, smooth shading, crisp), then the best remaining
 * trade-offs between likeness and ease.
 */
export function suggest(scored: Scored[], count: number): Suggestion[] {
  const picks: Suggestion[] = [];
  const add = (s: Scored | undefined, label: string, reason: string) => {
    if (!s || picks.length >= count) return;
    if (picks.some((p) => p.candidate === s.candidate || difference(p.pattern, s.pattern) < MIN_DIFFERENCE)) return;
    picks.push({ ...s, label, reason });
  };
  const best = (list: Scored[], key: (s: Scored) => number) => list.reduce<Scored | undefined>((b, s) => (!b || key(s) > key(b) ? s : b), undefined);
  // Ignore near-useless candidates for "simplest".
  const decent = scored.filter((s) => s.likeness >= 50);

  // Every pick prefers fewer colours when the look is about the same.
  add(best(scored, (s) => s.likeness - COLOR_PENALTY * s.colorLoad), "Most faithful", "Closest to the original");
  const top = Math.max(...scored.map((s) => s.likeness));
  const close = scored.filter((s) => s.likeness >= top - BALANCED_WITHIN);
  add(best(close, (s) => -s.colorLoad * 100 + s.likeness * 0.1 + s.ease * 0.05), "Balanced", "Nearly as faithful, with fewer colours");
  add(best(decent.length ? decent : scored, (s) => s.ease + s.likeness * 0.25), "Simplest", "Fewest colours and stray beads");
  add(best(scored.filter((s) => s.candidate.dither.mode !== "none"), (s) => s.likeness - COLOR_PENALTY * s.colorLoad), "Smooth shading", "Dithering blends colours across gradients");
  add(best(scored.filter((s) => s.candidate.sampling === "sharp" && s.candidate.dither.mode === "none"), (s) => s.likeness - COLOR_PENALTY * s.colorLoad), "Crisp", "Clean edges, no blending");

  // Fill up with the best remaining trade-offs (Pareto front first).
  const front = new Set(paretoFront(scored));
  const rest = [...scored].sort((a, b) => Number(front.has(b)) - Number(front.has(a)) || b.likeness + b.ease - (a.likeness + a.ease));
  for (const s of rest) add(s, "Alternative", s.likeness >= s.ease ? "Leans towards likeness" : "Leans towards simplicity");
  return picks;
}

// ---------------------------------------------------------------- running a scan

/**
 * Lets the page repaint and handle input between chunks. A MessageChannel
 * message, unlike setTimeout, isn't throttled to ~1/s when the tab is in the
 * background, so a scan keeps going at full speed if you switch tabs.
 */
function yieldToBrowser(): Promise<void> {
  if (typeof MessageChannel === "undefined") return new Promise((r) => setTimeout(r, 0));
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

export interface ScanProgress {
  done: number;
  total: number;
}

/**
 * Runs the scan, yielding to the browser between chunks so the page stays
 * responsive. Stops early (returning what it has) when `signal` is aborted.
 */
export async function scan(
  source: ImageSource,
  base: PipelineSettings,
  candidates: Candidate[],
  onProgress?: (p: ScanProgress) => void,
  signal?: AbortSignal,
  sliceMs = 24,
): Promise<{ candidate: Candidate; pattern: Pattern; metrics: Metrics }[]> {
  const results: { candidate: Candidate; pattern: Pattern; metrics: Metrics }[] = [];
  const references = new Map<string, ImageData>();
  let sliceStart = performance.now();
  for (let i = 0; i < candidates.length; i++) {
    if (signal?.aborted) break;
    const c = candidates[i]!;
    const { pattern, sampled } = buildPattern(source, candidateSettings(base, c));
    if (pattern.total > 0 && sampled) {
      const key = `${sampled.width}@${sampled.crop.x},${sampled.crop.y},${sampled.crop.w},${sampled.crop.h}`;
      let reference = references.get(key);
      if (!reference) {
        reference = sampleGrid(source, sampled.width, sampled.crop, "smooth", false);
        references.set(key, reference);
      }
      results.push({ candidate: c, pattern, metrics: scorePattern(pattern, reference, sampled.offsetX, sampled.offsetY) });
    }
    if (performance.now() - sliceStart > sliceMs) {
      onProgress?.({ done: i + 1, total: candidates.length });
      await yieldToBrowser();
      sliceStart = performance.now();
    }
  }
  onProgress?.({ done: candidates.length, total: candidates.length });
  return results;
}

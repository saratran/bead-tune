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

// ---------------------------------------------------------------- colour tone

/**
 * The look you're after. Likeness is measured against the original with its
 * colour intensity (Lab chroma) scaled, so "vivid" rewards richer colours and
 * "muted" softer ones, instead of strict accuracy.
 */
export type Tone = "natural" | "vivid" | "muted";
export const TONES: Tone[] = ["natural", "vivid", "muted"];
export const TONE_CHROMA: Record<Tone, number> = { natural: 1, vivid: 1.25, muted: 0.75 };
export const TONE_LABEL: Record<Tone, string> = { natural: "Natural", vivid: "Vivid", muted: "Muted" };
/** Extra saturation values tried for a tone, so the grid can reach that look. */
const TONE_SATURATION: Record<Tone, number[]> = { natural: [], vivid: [25, 50], muted: [-25, -50] };

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
  // Accurate (CIEDE2000) keeps more detail with fewer colours on real images, and is
  // only ~1.7× slower now that matching is shortlisted (see scripts/eval-auto.ts --metric).
  metric: ["accurate"],
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
  brightness: [-50, -35, -20, -10, 0, 10, 20, 35, 50],
  contrast: [-40, -20, -10, 0, 15, 30, 50, 70],
  saturation: [-50, -20, 0, 20, 40, 60, 80],
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
  /** How much of the original's strongest edges (outlines, features) the pattern lost, 0–1. */
  featureLoss: number;
  /** Mean ΔE2000 on the very most distinctive cells (top few %): eyes, pupils, small marks. */
  keyDetailError: number;
  /**
   * How well the original's darkest and brightest spots (outlines, pupils, sparkles,
   * highlights) keep their lightness: mean |ΔL| there, in L units.
   */
  extremeLoss: number;
  /** Speckle the original doesn't have: mean extra bead-to-neighbourhood ΔE. */
  noise: number;
  /**
   * How far the pattern's overall colour intensity is from the target tone's
   * (relative): 0 = just as vivid as wanted.
   */
  toneError: number;
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

function labGridFromImage(img: ImageData, chroma = 1): Grid {
  const n = img.width * img.height;
  const lab = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    if (img.data[i * 4 + 3]! < 128) {
      lab[i * 3] = NaN;
      continue;
    }
    const [L, a, b] = rgbToLab(img.data[i * 4]!, img.data[i * 4 + 1]!, img.data[i * 4 + 2]!);
    lab[i * 3] = L;
    lab[i * 3 + 1] = a * chroma;
    lab[i * 3 + 2] = b * chroma;
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
/** Share of cells with the strongest original edges that count as "features". */
const FEATURE_SHARE = 0.15;
/** Ignore near-flat images: edges weaker than this (ΔL per Sobel) aren't features. */
const MIN_FEATURE_EDGE = 8;

/** Share of cells (most detailed first) used for detailError. */
const DETAIL_SHARE = 0.15;
/** Share of cells (most detailed first) used for keyDetailError. */
const KEY_SHARE = 0.03;
/** Share of the darkest and of the brightest cells used for extremeLoss. */
const EXTREME_SHARE = 0.03;

export function scorePattern(pattern: Pattern, reference: ImageData, offsetX = 0, offsetY = 0, chroma = 1): Metrics {
  const { width: w, height: h } = pattern;
  const ref: Grid = { w, h, lab: new Float32Array(w * h * 3).fill(NaN) };
  const pat: Grid = { w, h, lab: new Float32Array(w * h * 3).fill(NaN) };
  const refFull = labGridFromImage(reference, chroma);
  let colorSum = 0;
  let compared = 0;
  let patChroma = 0;
  let refChroma = 0;
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
        patChroma += Math.hypot(pattern.colors[idx]!.lab[1], pattern.colors[idx]!.lab[2]);
        refChroma += Math.hypot(ref.lab[i * 3 + 1]!, ref.lab[i * 3 + 2]!);
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
  const patEdges = edges(bp);
  const refEdges = edges(br);
  const edgeError = 1 - correlation(patEdges, refEdges);

  // Feature loss: of the original's strongest edges (top FEATURE_SHARE), how many
  // have no comparable edge in the pattern? Outlines, eyes and contours live here.
  const strong: number[] = [];
  for (let i = 0; i < refEdges.length; i++) if (!Number.isNaN(refEdges[i]!) && !Number.isNaN(patEdges[i]!)) strong.push(i);
  strong.sort((a, b) => refEdges[b]! - refEdges[a]!);
  const featureCells = strong.slice(0, Math.max(1, Math.round(strong.length * FEATURE_SHARE))).filter((i) => refEdges[i]! > MIN_FEATURE_EDGE);
  // Soft loss: a feature whose edge is half as strong counts as half lost.
  const lost = featureCells.reduce((sum, i) => sum + Math.min(1, Math.max(0, 1 - patEdges[i]! / refEdges[i]!)), 0);
  const featureLoss = featureCells.length ? lost / featureCells.length : 0;

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
  const keyCells = saliency.slice(0, Math.max(1, Math.round(saliency.length * KEY_SHARE)));
  const keyDetailError = saliency.length ? keyCells.reduce((sum, c) => sum + cellError[c.i]!, 0) / keyCells.length : 0;

  // Extremes: the darkest and brightest few % of the original should stay as dark / bright.
  // Pulled towards the middle counts fully; pushed further out (crushed to black, blown
  // to white, as contrast boosts do) counts too, so adjustments can't game it.
  const lit: number[] = [];
  for (let i = 0; i < w * h; i++) if (!Number.isNaN(cellError[i]!)) lit.push(i);
  lit.sort((a, b) => ref.lab[a * 3]! - ref.lab[b * 3]!);
  const k = Math.max(1, Math.round(lit.length * EXTREME_SHARE));
  let extremeSum = 0;
  for (const i of lit.slice(0, k)) extremeSum += Math.abs(pat.lab[i * 3]! - ref.lab[i * 3]!);
  for (const i of lit.slice(-k)) extremeSum += Math.abs(ref.lab[i * 3]! - pat.lab[i * 3]!);
  const extremeLoss = lit.length ? extremeSum / (2 * k) : 0;

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
    keyDetailError,
    extremeLoss,
    distanceError: distN ? distSum / distN : 0,
    edgeError,
    featureLoss,
    noise: noiseN ? noiseSum / noiseN : 0,
    // Relative to the target's intensity, with a floor so near-grey images don't explode it.
    toneError: compared ? Math.abs(patChroma - refChroma) / compared / Math.max(5, refChroma / compared) : 0,
    colors: pattern.colors.length,
    beads: pattern.total,
    strays,
    fragmentation: pattern.total ? (regions / pattern.total) * 100 : 0,
  };
}

// ---------------------------------------------------------------- selection

/** Relative weights; tuned on real images (see scripts/tune-auto.ts). */
export const WEIGHTS = {
  likeness: { color: 0.22, detail: 0.22, distance: 0.17, edge: 0.08, noise: 0.16, tone: 0.15 },
  effort: { colors: 0.45, strays: 0.35, fragmentation: 0.2 },
};

export interface Scored {
  candidate: Candidate;
  pattern: Pattern;
  metrics: Metrics;
  /** 0–100 within this scan: how well outlines and fine features survive. */
  features: number;
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
    featureLoss: normaliser(m.map((x) => x.featureLoss)),
    tone: normaliser(m.map((x) => x.toneError)),
    // Log scale: going from 12 to 24 colours matters as much as 32 to 64.
    colors: normaliser(m.map((x) => Math.log(x.colors))),
    strays: normaliser(m.map((x) => x.strays / Math.max(1, x.beads))),
    fragmentation: normaliser(m.map((x) => x.fragmentation)),
  };
  const L = WEIGHTS.likeness, E = WEIGHTS.effort;
  return results.map((r) => {
    const x = r.metrics;
    const bad = L.color * n.color(x.colorError) + L.detail * n.detail(x.detailError) + L.distance * n.distance(x.distanceError) + L.edge * n.edge(x.edgeError) + L.noise * n.noise(x.noise) + L.tone * n.tone(x.toneError);
    const effort = E.colors * n.colors(Math.log(x.colors)) + E.strays * n.strays(x.strays / Math.max(1, x.beads)) + E.fragmentation * n.fragmentation(x.fragmentation);
    return {
      ...r,
      likeness: Math.round((1 - bad) * 100),
      features: Math.round((1 - (0.4 * n.featureLoss(x.featureLoss) + 0.35 * n.detail(x.detailError) + 0.25 * n.edge(x.edgeError))) * 100),
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
  add(best(scored, (s) => (s.likeness + s.features) / 2 - COLOR_PENALTY * s.colorLoad), "Most faithful", "Closest to the original, features included");
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
  /** "search" = trying the grid of combinations; "refine" = fine-tuning suggestions. */
  phase?: "search" | "refine";
  done: number;
  total: number;
}

export interface Evaluated {
  candidate: Candidate;
  pattern: Pattern;
  metrics: Metrics;
}

/**
 * Builds and scores candidates, caching results (refinement revisits points)
 * and the reference images they're compared against.
 */
type Built = { pattern: Pattern; sampled: NonNullable<ReturnType<typeof buildPattern>["sampled"]> } | null;

export function makeEvaluator(source: ImageSource, base: PipelineSettings, tone: Tone = "natural", builds = new Map<string, Built>()) {
  const references = new Map<string, ImageData>();
  const cache = new Map<string, Evaluated | null>();
  return (c: Candidate): Evaluated | null => {
    const key = JSON.stringify(c);
    if (cache.has(key)) return cache.get(key)!;
    // Building is the slow part; scoring for another tone reuses the build.
    let built = builds.get(key);
    if (built === undefined) {
      const { pattern, sampled } = buildPattern(source, candidateSettings(base, c));
      built = pattern.total > 0 && sampled ? { pattern, sampled } : null;
      builds.set(key, built);
    }
    let result: Evaluated | null = null;
    if (built) {
      const { pattern, sampled } = built;
      const refKey = `${sampled.width}@${sampled.crop.x},${sampled.crop.y},${sampled.crop.w},${sampled.crop.h}`;
      let reference = references.get(refKey);
      if (!reference) {
        reference = sampleGrid(source, sampled.width, sampled.crop, "smooth", false);
        references.set(refKey, reference);
      }
      result = { candidate: c, pattern, metrics: scorePattern(pattern, reference, sampled.offsetX, sampled.offsetY, TONE_CHROMA[tone]) };
    }
    cache.set(key, result);
    return result;
  };
}

/**
 * Evaluates several candidates (for one colour tone), possibly in parallel.
 * Results come back in order; null = an empty pattern, or skipped after `signal` aborted.
 * `onEach` is called as each one finishes.
 */
export type EvaluateMany = (candidates: Candidate[], onEach?: () => void, signal?: AbortSignal) => Promise<(Evaluated | null)[]>;

/** Where candidates get built and scored: on this thread, or a pool of Web Workers. */
export interface AutoEngine {
  forTone(tone: Tone): EvaluateMany;
  /** Stops any workers (the engine can't be used afterwards). */
  dispose?(): void;
}

/**
 * Runs a one-at-a-time evaluator over a batch, yielding to the browser between
 * chunks of `sliceMs` so the page stays responsive.
 */
export function batched(evaluate: (c: Candidate) => Evaluated | null, sliceMs = 24): EvaluateMany {
  return async (candidates, onEach, signal) => {
    const out: (Evaluated | null)[] = [];
    let sliceStart = performance.now();
    for (const c of candidates) {
      if (signal?.aborted) {
        out.push(null);
        continue;
      }
      out.push(evaluate(c));
      onEach?.();
      if (performance.now() - sliceStart > sliceMs) {
        await yieldToBrowser();
        sliceStart = performance.now();
      }
    }
    return out;
  };
}

/** Evaluates on this thread, sharing pattern builds between tones. */
export function localEngine(source: ImageSource, base: PipelineSettings, sliceMs = 24): AutoEngine {
  const builds = new Map<string, Built>();
  const tones = new Map<Tone, EvaluateMany>();
  return {
    forTone(tone) {
      if (!tones.has(tone)) tones.set(tone, batched(makeEvaluator(source, base, tone, builds), sliceMs));
      return tones.get(tone)!;
    },
  };
}

/**
 * Runs the scan. Stops early (returning what it has) when `signal` is aborted.
 */
export async function scan(
  source: ImageSource,
  base: PipelineSettings,
  candidates: Candidate[],
  onProgress?: (p: ScanProgress) => void,
  signal?: AbortSignal,
  sliceMs = 24,
  evaluate: EvaluateMany = batched(makeEvaluator(source, base), sliceMs),
): Promise<Evaluated[]> {
  let done = 0;
  const results = await evaluate(candidates, () => onProgress?.({ phase: "search", done: ++done, total: candidates.length }), signal);
  onProgress?.({ phase: "search", done: candidates.length, total: candidates.length });
  return results.filter((r): r is Evaluated => r !== null);
}

// ---------------------------------------------------------------- scores shown to people

/**
 * Displayed scores are anchored to the image, not to whatever a search happened
 * to try, so they mean the same for suggestions, bookmarks, your own settings and
 * every run: 100 = as good as beads get for this image (all colours, accurate
 * matching, nothing simplified); 0 = a deliberately crude version (6 colours,
 * heavy clean-up). Ease runs the other way: the crude version is 100.
 * Bump SCORE_VERSION when this scale changes, so stored bookmarks are re-scored.
 */
export const SCORE_VERSION = 2;

export interface Anchors {
  best: Metrics;
  crude: Metrics;
}

export interface Scores {
  features: number;
  likeness: number;
  ease: number;
}

/** The two reference settings for a tone (vivid/muted anchors lean the same way). */
export function anchorCandidates(tone: Tone = "natural"): { best: Candidate; crude: Candidate } {
  const saturation = TONE_SATURATION[tone][0] ?? 0;
  const plain = { sampling: "smooth" as const, denoise: false, dither: { mode: "none" as const, strength: 0 }, minBeads: 0, brightness: 0, contrast: 0, saturation };
  return {
    best: { ...plain, maxColors: 120, cleanup: 0, metric: "accurate" },
    crude: { ...plain, maxColors: 6, cleanup: 3, metric: "standard" },
  };
}

/** Scores the anchors with `evaluate` (null if the image gives an empty pattern). */
export async function anchorsFor(evaluate: EvaluateMany, tone: Tone = "natural", signal?: AbortSignal): Promise<Anchors | null> {
  const { best, crude } = anchorCandidates(tone);
  const [b, c] = await evaluate([best, crude], undefined, signal);
  return b && c ? { best: b.metrics, crude: c.metrics } : null;
}

/** As anchorsFor, for a one-at-a-time evaluator. */
export function anchorsSync(evaluate: (c: Candidate) => Evaluated | null, tone: Tone = "natural"): Anchors | null {
  const { best, crude } = anchorCandidates(tone);
  const b = evaluate(best), c = evaluate(crude);
  return b && c ? { best: b.metrics, crude: c.metrics } : null;
}

/** 0–100 between the anchors: `good` scores 100, `bad` 0; clamped. */
function between(value: number, good: number, bad: number): number {
  const span = bad - good;
  if (Math.abs(span) < 1e-9) return 50;
  return Math.round(Math.min(100, Math.max(0, (100 * (bad - value)) / span)));
}

export function absoluteScores(m: Metrics, a: Anchors): Scores {
  return {
    features: between(featureCost(m), featureCost(a.best), featureCost(a.crude)),
    likeness: between(likenessCost(m), likenessCost(a.best), likenessCost(a.crude)),
    ease: between(effortCost(m), effortCost(a.crude), effortCost(a.best)),
  };
}

/** Replaces a suggestion's search-relative scores with image-anchored ones. */
export function withAbsoluteScores<T extends { metrics: Metrics } & Scores>(s: T, anchors: Anchors | null): T {
  return anchors ? { ...s, ...absoluteScores(s.metrics, anchors) } : s;
}

/** The tone a set of settings is going for, judged by its saturation. */
export function toneForSaturation(saturation: number): Tone {
  return saturation >= 20 ? "vivid" : saturation <= -20 ? "muted" : "natural";
}

// ---------------------------------------------------------------- refinement

/*
 * Refinement needs a score that doesn't depend on the rest of the scan, so
 * these use fixed scales (typical ranges seen on real images) instead of the
 * scan-relative 0–100 likeness/ease.
 */

/** 0 ≈ perfect; ~1 ≈ poor. */
export function likenessCost(m: Metrics): number {
  return (
    0.22 * (m.colorError / 10) +
    0.22 * (m.detailError / 10) +
    0.17 * (m.distanceError / 8) +
    0.08 * (m.edgeError / 0.15) +
    0.16 * (m.noise / 4) +
    0.15 * (m.toneError / 0.3)
  );
}

/** 0 ≈ every outline and fine feature kept; ~1 ≈ most lost. */
export function featureCost(m: Metrics): number {
  return (
    0.25 * (m.detailError / 10) +
    0.25 * (m.featureLoss / 0.15) +
    0.2 * (m.edgeError / 0.15) +
    // Small, telling details (eyes, pupils, sparkles) that the broader measures average away.
    0.15 * (m.keyDetailError / 15) +
    0.15 * (m.extremeLoss / 6)
  );
}

/** Colour count on a log scale: 0 at 2 colours, 1 at 120. */
export function colorCost(m: Metrics): number {
  return Math.log(Math.max(2, m.colors) / 2) / Math.log(60);
}

/** 0 ≈ trivial to make; ~1 ≈ lots of colours, strays and small areas. */
export function effortCost(m: Metrics): number {
  return 0.45 * colorCost(m) + 0.35 * (m.strays / Math.max(1, m.beads) / 0.3) + 0.2 * (m.fragmentation / 50);
}

/**
 * How much worse (as a fraction) refinement may make a suggestion's likeness
 * while improving its own goal. Keeps "Simplest" from collapsing to 3 colours.
 */
/** How much of its features refinement may give up while making a suggestion simpler. */
export function featureToleranceFor(label: string): number | undefined {
  return label === "Simplest" ? 0.05 : undefined;
}

export function likenessToleranceFor(label: string): number {
  return label === "Simplest" ? 0.04 : 0.03;
}

/**
 * What each kind of suggestion is fine-tuned for (lower is better). Keeping the
 * original's features comes first; overall colour likeness and ease follow.
 */
export function objectiveFor(label: string): (m: Metrics) => number {
  switch (label) {
    case "Simplest":
      return (m) => effortCost(m) + 0.6 * featureCost(m);
    case "Balanced":
      return (m) => featureCost(m) + 0.3 * likenessCost(m) + 0.35 * effortCost(m);
    case "Alternative":
      return (m) => featureCost(m) + 0.3 * likenessCost(m) + 0.2 * effortCost(m);
    default: // Most faithful, Smooth shading, Crisp, and tuning from preferences
      return (m) => featureCost(m) + 0.5 * likenessCost(m) + 0.05 * colorCost(m);
  }
}

export type RefineMethod = "pattern" | "anneal";

export interface RefineOptions {
  method: RefineMethod;
  /** Most extra candidates to try per suggestion. */
  budget: number;
  /** Seed for annealing's random moves (results are repeatable). */
  seed?: number;
  /** Max fractional loss of likeness allowed versus the starting point (default 3%). */
  likenessTolerance?: number;
  /** Max fractional loss of features (featureCost) allowed versus the starting point (default: no limit). */
  featureTolerance?: number;
  /** If set, results must not be harder to make than this (effortCost). */
  maxEffortCost?: number;
}

/** A continuous setting refinement may move, with its range and step sizes. */
interface Dim {
  key: "brightness" | "contrast" | "saturation" | "maxColors" | "ditherStrength";
  lo: number;
  hi: number;
  step: number;
  minStep: number;
  /** Step in log space (colour count: ×1.3 rather than +n). */
  log?: boolean;
}

const DIMS: Dim[] = [
  { key: "maxColors", lo: 2, hi: 120, step: Math.log(1.35), minStep: Math.log(1.04), log: true },
  { key: "brightness", lo: -100, hi: 100, step: 10, minStep: 2 },
  { key: "contrast", lo: -100, hi: 100, step: 10, minStep: 2 },
  { key: "saturation", lo: -100, hi: 100, step: 10, minStep: 2 },
  // Dithered styles stay dithered: below ~30% it's barely there.
  { key: "ditherStrength", lo: 30, hi: 100, step: 15, minStep: 3 },
];

function getDim(c: Candidate, d: Dim): number {
  return d.key === "ditherStrength" ? c.dither.strength : c[d.key];
}

function withDim(c: Candidate, d: Dim, value: number): Candidate {
  const v = Math.round(Math.min(d.hi, Math.max(d.lo, value)));
  return d.key === "ditherStrength" ? { ...c, dither: { ...c.dither, strength: v } } : { ...c, [d.key]: v };
}

function move(c: Candidate, d: Dim, delta: number): Candidate {
  const now = getDim(c, d);
  const next = d.log ? Math.exp(Math.log(now) + delta) : now + delta;
  let out = withDim(c, d, next);
  // Integers: make sure a small step still moves.
  if (getDim(out, d) === now && delta !== 0) out = withDim(c, d, now + Math.sign(delta));
  return out;
}

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fine-tunes the continuous settings of `start` (its categorical choices stay
 * fixed) to lower `objective`. Returns the best found and everything tried.
 */
export async function refine(
  evaluate: EvaluateMany,
  start: Evaluated,
  objective: (m: Metrics) => number,
  opts: RefineOptions,
  signal?: AbortSignal,
  onStep?: () => void,
): Promise<{ best: Evaluated; tried: Evaluated[] }> {
  const dims = DIMS.filter((d) => d.key !== "ditherStrength" || start.candidate.dither.mode !== "none");
  const tried: Evaluated[] = [];
  const maxLikenessCost = likenessCost(start.metrics) * (1 + (opts.likenessTolerance ?? 0.03));
  const maxFeatureCost = featureCost(start.metrics) * (1 + (opts.featureTolerance ?? Infinity));
  // Out-of-bounds results count as infinitely bad.
  const maxEffort = opts.maxEffortCost ?? Infinity;
  const cost = (m: Metrics) => (likenessCost(m) > maxLikenessCost || featureCost(m) > maxFeatureCost || effortCost(m) > maxEffort ? Infinity : objective(m));
  let best = start;
  let bestCost = cost(start.metrics);
  let spent = 0;

  const tryMany = async (cs: Candidate[]): Promise<(Evaluated | null)[]> => {
    spent += cs.length;
    const rs = await evaluate(cs, onStep, signal);
    for (const r of rs) if (r) tried.push(r);
    return rs;
  };

  if (opts.method === "pattern") {
    // Compass search: try ± each setting (all at once, so they can run in parallel),
    // move to the best improvement; halve steps when nothing improves.
    const steps = new Map(dims.map((d) => [d.key, d.step]));
    while (spent < opts.budget && !signal?.aborted) {
      const moves: Candidate[] = [];
      for (const d of dims) {
        for (const dir of [1, -1]) {
          const next = move(best.candidate, d, dir * steps.get(d.key)!);
          if (getDim(next, d) !== getDim(best.candidate, d)) moves.push(next); // else at the edge
        }
      }
      let improved = false;
      const batch = moves.slice(0, opts.budget - spent);
      if (batch.length) {
        for (const r of await tryMany(batch)) {
          if (r && cost(r.metrics) < bestCost - 1e-9) {
            best = r;
            bestCost = cost(r.metrics);
            improved = true;
          }
        }
      }
      if (!improved) {
        let anyLeft = false;
        for (const d of dims) {
          const s = steps.get(d.key)! / 2;
          steps.set(d.key, s);
          if (s >= d.minStep) anyLeft = true;
        }
        if (!anyLeft) break;
      }
    }
  } else {
    // Simulated annealing: random moves, sometimes accepting worse ones while "hot".
    const random = rng(opts.seed ?? 1);
    const gauss = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
    let current = start;
    let currentCost = bestCost;
    const t0 = 0.03;
    const t1 = 0.0005;
    for (let i = 0; i < opts.budget && !signal?.aborted; i++) {
      const temp = t0 * Math.pow(t1 / t0, i / Math.max(1, opts.budget - 1));
      const d = dims[Math.floor(random() * dims.length)]!;
      const scale = d.step * (0.3 + (temp / t0) * 0.7);
      const next = move(current.candidate, d, gauss() * scale);
      const [r] = await tryMany([next]);
      if (!r) continue;
      const c = cost(r.metrics);
      if (c < currentCost || random() < Math.exp((currentCost - c) / temp)) {
        current = r;
        currentCost = c;
      }
      if (c < bestCost) {
        best = r;
        bestCost = c;
      }
    }
  }
  return { best, tried };
}

// ---------------------------------------------------------------- the whole thing

export interface AutoOptions {
  space: SearchSpace;
  count: number;
  limit: number;
  /** Fine-tune each suggestion's continuous settings after the grid search. */
  refine?: RefineOptions | null;
  /** Colour tones to find suggestions for (default: natural only). */
  tones?: Tone[];
}

export interface RefinedSuggestion extends Suggestion {
  /** The grid candidate this was fine-tuned from (absent if refinement didn't help). */
  refinedFrom?: Candidate;
  /** The colour tone this suggestion was chosen for. */
  tone?: Tone;
}

/** The search space for a tone: adds saturation values that lead towards it. */
export function spaceForTone(space: SearchSpace, tone: Tone): SearchSpace {
  const extra = TONE_SATURATION[tone].filter((v) => !space.saturation.includes(v));
  return extra.length ? { ...space, saturation: [...space.saturation, ...extra].sort((a, b) => a - b) } : space;
}

/** Grid search → suggestions → (optionally) fine-tune each one, for each colour tone. */
export async function autoSuggest(
  source: ImageSource,
  base: PipelineSettings,
  options: AutoOptions,
  onProgress?: (p: ScanProgress) => void,
  signal?: AbortSignal,
  engine: AutoEngine = localEngine(source, base),
): Promise<RefinedSuggestion[]> {
  const tones = options.tones?.length ? options.tones : (["natural"] as Tone[]);
  const plans = tones.map((tone) => ({ tone, candidates: enumerateCandidates(spaceForTone(options.space, tone), options.limit) }));
  const searchTotal = plans.reduce((n, p) => n + p.candidates.length, 0);
  const refineTotal = options.refine ? tones.length * options.count * options.refine.budget : 0;
  let searchDone = 0;
  let refineDone = 0;

  const out: RefinedSuggestion[] = [];
  for (const { tone, candidates } of plans) {
    if (signal?.aborted) break;
    const evaluate = engine.forTone(tone);
    const offset = searchDone;
    const grid = await scan(source, base, candidates, (p) => onProgress?.({ phase: "search", done: offset + p.done, total: searchTotal }), signal, 24, evaluate);
    searchDone += candidates.length;
    if (!grid.length) continue;
    const picks = suggest(rate(grid), options.count);

    let finals: RefinedSuggestion[] = picks;
    if (options.refine && !signal?.aborted) {
      const pool: Evaluated[] = [...grid];
      const refineOpts = options.refine;
      // Every pick is fine-tuned at the same time (each one's steps are sequential).
      const runs = await Promise.all(
        picks.map((pick, n) =>
          refine(
            evaluate,
            pick,
            objectiveFor(pick.label),
            { likenessTolerance: likenessToleranceFor(pick.label), featureTolerance: featureToleranceFor(pick.label), ...refineOpts, seed: (refineOpts.seed ?? 1) + n },
            signal,
            () => onProgress?.({ phase: "refine", done: ++refineDone, total: refineTotal }),
          ),
        ),
      );
      const refined: { label: string; reason: string; from: Candidate; best: Evaluated }[] = [];
      for (const [n, { best, tried }] of runs.entries()) {
        const pick = picks[n]!;
        pool.push(...tried);
        refined.push({ label: pick.label, reason: pick.reason, from: pick.candidate, best });
      }
      // Re-rate everything together so the 0–100 scores stay comparable.
      const rated = new Map(rate(pool).map((r) => [JSON.stringify(r.candidate), r]));
      finals = [];
      for (const r of refined) {
        const s = rated.get(JSON.stringify(r.best.candidate))!;
        if (finals.some((o) => difference(o.pattern, s.pattern) < MIN_DIFFERENCE)) continue;
        const changed = JSON.stringify(r.best.candidate) !== JSON.stringify(r.from);
        finals.push({ ...s, label: r.label, reason: r.reason, ...(changed ? { refinedFrom: r.from } : {}) });
      }
    }
    // Shown scores are anchored to the image (see SCORE_VERSION); selection above used the search's own spread.
    const anchors = await anchorsFor(evaluate, tone, signal);
    // A pattern already suggested for another tone isn't repeated.
    for (const f of finals) if (!out.some((o) => difference(o.pattern, f.pattern) < MIN_DIFFERENCE)) out.push(withAbsoluteScores({ ...f, tone }, anchors));
  }
  if (options.refine) onProgress?.({ phase: "refine", done: refineTotal, total: refineTotal });
  return out;
}

// ---------------------------------------------------------------- tuning from the user's picks

/** Close variations of a pick: flip one categorical choice at a time. */
export function neighbours(c: Candidate): Candidate[] {
  const out: Candidate[] = [
    { ...c, sampling: c.sampling === "smooth" ? "sharp" : "smooth" },
    { ...c, denoise: !c.denoise },
    { ...c, metric: c.metric === "standard" ? "accurate" : "standard" },
  ];
  if (c.cleanup > 0) out.push({ ...c, cleanup: c.cleanup - 1 });
  if (c.cleanup < 3) out.push({ ...c, cleanup: c.cleanup + 1 });
  if (c.minBeads > 0) out.push({ ...c, minBeads: 0 });
  else out.push({ ...c, minBeads: 3 });
  if (c.dither.mode === "none") out.push({ ...c, dither: { mode: "diffusion", strength: 40 } });
  else out.push({ ...c, dither: { mode: "none", strength: 0 } }, { ...c, dither: { mode: c.dither.mode === "diffusion" ? "ordered" : "diffusion", strength: c.dither.strength } });
  return out;
}

export interface PreferenceSeed {
  label: string;
  candidate: Candidate;
  /** Tune towards this colour tone (default natural). */
  tone?: Tone;
}

/** Labels "More like this" puts in front of a pick's name, one per kind of variation. */
export const TUNED_PREFIXES = ["Tuned", "Simpler", "More detail", "Variation"] as const;

/** A pick's name without any "Tuned: " / "Simpler: " … prefixes. */
export function pickName(label: string): string {
  const re = new RegExp(`^(${TUNED_PREFIXES.join("|")})( \\d+)?: `);
  let out = label;
  while (re.test(out)) out = out.replace(re, "");
  return out;
}

/**
 * "More like this": for each pick, several variations close to it —
 *  - Tuned: the pick's level of simplicity, keeping as many features as possible;
 *  - Simpler: easier to make, giving up a little likeness;
 *  - More detail: keeps more features, allowing a bit more effort;
 *  - Variation: other close settings that look noticeably different.
 * Up to `count` results in total, the picks taking turns (all "Tuned" first).
 */
export async function tuneFromPreferences(
  source: ImageSource,
  base: PipelineSettings,
  seeds: PreferenceSeed[],
  options: { count: number; refine: RefineOptions },
  onProgress?: (p: ScanProgress) => void,
  signal?: AbortSignal,
  engine: AutoEngine = localEngine(source, base),
): Promise<RefinedSuggestion[]> {
  const objective = objectiveFor("Most faithful");
  const simpler = objectiveFor("Simplest");
  // Shorter runs for the extra variations, so tuning stays quick.
  const sideBudget = Math.max(10, Math.round(options.refine.budget / 2));
  const perSeed = 1 + neighbours(seeds[0]?.candidate ?? ({} as Candidate)).length + options.refine.budget + 2 * sideBudget;
  const total = Math.max(1, seeds.length * perSeed);
  let done = 0;
  const step = () => onProgress?.({ phase: "refine", done: ++done, total });
  const pools = new Map<Tone, Evaluated[]>();
  type Variation = { label: string; reason: string; from: Candidate; best: Evaluated; tone: Tone };
  const perPick: Variation[][] = [];

  // Each pick is tuned at the same time as the others.
  const tuneOne = async (seed: PreferenceSeed, n: number): Promise<{ tone: Tone; mine: Evaluated[]; out: Variation[] } | null> => {
    const tone = seed.tone ?? "natural";
    const name = pickName(seed.label);
    const evaluate = engine.forTone(tone);
    const [start] = await evaluate([seed.candidate], step, signal);
    if (!start || signal?.aborted) return null;
    const mine: Evaluated[] = [start];
    // Stay at (or below) the pick's level of effort; allow a hair of slack.
    const maxEffortCost = effortCost(start.metrics) * 1.05;
    const allowed = (m: Metrics) => effortCost(m) <= maxEffortCost && likenessCost(m) <= likenessCost(start.metrics) * 1.03;
    let best = start;
    for (const r of await evaluate(neighbours(seed.candidate), step, signal)) {
      if (!r) continue;
      mine.push(r);
      if (allowed(r.metrics) && objective(r.metrics) < objective(best.metrics)) best = r;
    }
    const seedOf = (k: number) => (options.refine.seed ?? 1) + n * 10 + k;
    // "Simpler" starts from the pick itself, so it runs alongside the main tuning.
    const [tuned, easy] = await Promise.all([
      refine(evaluate, best, objective, { ...options.refine, seed: seedOf(0), maxEffortCost, likenessTolerance: 0.03 }, signal, step),
      refine(evaluate, start, simpler, { ...options.refine, budget: sideBudget, seed: seedOf(1), likenessTolerance: 0.08, featureTolerance: 0.08 }, signal, step),
    ]);
    mine.push(...tuned.tried, ...easy.tried);
    const out: Variation[] = [{ label: `Tuned: ${name}`, reason: "Your pick, adjusted to keep more of the original's features", from: seed.candidate, best: tuned.best, tone }];
    if (!signal?.aborted && effortCost(easy.best.metrics) < effortCost(tuned.best.metrics) * 0.95) {
      out.push({ label: `Simpler: ${name}`, reason: "Like your pick, but easier to make (fewer colours or strays)", from: seed.candidate, best: easy.best, tone });
    }
    if (!signal?.aborted) {
      const rich = await refine(evaluate, tuned.best, (m) => featureCost(m) + 0.5 * likenessCost(m), { ...options.refine, budget: sideBudget, seed: seedOf(2), maxEffortCost: effortCost(start.metrics) * 1.35, likenessTolerance: 0.03 }, signal, step);
      mine.push(...rich.tried);
      if (featureCost(rich.best.metrics) < featureCost(tuned.best.metrics) * 0.97) {
        out.push({ label: `More detail: ${name}`, reason: "Like your pick, keeping more fine detail (a bit more effort)", from: seed.candidate, best: rich.best, tone });
      }
    }
    // Other close settings, best first, kept only if they look different from what's already offered.
    const near = mine
      .filter((r) => effortCost(r.metrics) <= effortCost(start.metrics) * 1.25 && likenessCost(r.metrics) <= likenessCost(start.metrics) * 1.1)
      .sort((a, b) => objective(a.metrics) - objective(b.metrics));
    let v = 0;
    for (const r of near) {
      if (v >= 4) break;
      if ([start, ...out.map((o) => o.best)].some((o) => difference(o.pattern, r.pattern) < MIN_DIFFERENCE / 2)) continue;
      v++;
      out.push({ label: `Variation ${v}: ${name}`, reason: "A close alternative to your pick", from: seed.candidate, best: r, tone });
    }
    return { tone, mine, out };
  };
  for (const done of await Promise.all(seeds.map(tuneOne))) {
    if (!done) continue;
    if (!pools.has(done.tone)) pools.set(done.tone, []);
    pools.get(done.tone)!.push(...done.mine);
    perPick.push(done.out);
  }
  onProgress?.({ phase: "refine", done: total, total });

  const rated = new Map([...pools].map(([tone, pool]) => [tone, new Map(rate(pool).map((r) => [JSON.stringify(r.candidate), r]))]));
  const anchors = new Map<Tone, Anchors | null>();
  for (const tone of pools.keys()) anchors.set(tone, await anchorsFor(engine.forTone(tone), tone, signal));
  const out: RefinedSuggestion[] = [];
  // Picks take turns: every pick's "Tuned" first, then their second variation, and so on.
  for (let k = 0; out.length < options.count && perPick.some((l) => l.length > k); k++) {
    for (const list of perPick) {
      const r = list[k];
      if (!r || out.length >= options.count) continue;
      const s = rated.get(r.tone)!.get(JSON.stringify(r.best.candidate))!;
      if (out.some((o) => difference(o.pattern, s.pattern) < MIN_DIFFERENCE / 2)) continue;
      const changed = JSON.stringify(r.best.candidate) !== JSON.stringify(r.from);
      out.push(withAbsoluteScores({ ...s, label: r.label, tone: r.tone, reason: changed ? r.reason : "Already the best version of this pick", ...(changed ? { refinedFrom: r.from } : {}) }, anchors.get(r.tone) ?? null));
    }
  }
  return out;
}

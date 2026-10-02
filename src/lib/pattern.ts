import { colorDistance, labDistSq, rgbToLab, type ColorMetric, type Lab, type RGB } from "./color";
import type { BeadColor } from "./palettes";

export interface Adjustments {
  brightness: number; // -100..100
  contrast: number; // -100..100
  saturation: number; // -100..100
}

export const DEFAULT_ADJUSTMENTS: Adjustments = { brightness: 0, contrast: 0, saturation: 0 };

export type DitherMode = "none" | "diffusion" | "ordered";

export interface PatternOptions {
  palette: BeadColor[];
  maxColors: number;
  /** Colours used by fewer beads than this are merged into their nearest neighbour (0/1 = off). */
  minBeads: number;
  dither: DitherMode;
  /** 0–100. */
  ditherStrength: number;
  metric: ColorMetric;
  removeBackground: boolean;
  /** How different (Lab ΔE) a pixel may be from the background colour and still count as background. */
  bgTolerance: number;
  /** Background colour to remove; detected from the image border when omitted. */
  bgColor?: RGB | null;
  adjustments: Adjustments;
}

export const DEFAULT_PATTERN_OPTIONS: Omit<PatternOptions, "palette"> = {
  maxColors: 24,
  minBeads: 0,
  dither: "none",
  ditherStrength: 85,
  metric: "standard",
  removeBackground: false,
  bgTolerance: 14,
  bgColor: null,
  adjustments: DEFAULT_ADJUSTMENTS,
};

export interface Pattern {
  width: number;
  height: number;
  /** Index into `colors` for each cell, row-major; -1 means no bead. */
  cells: Int16Array;
  /** Colours used, sorted by count (most used first). */
  colors: BeadColor[];
  counts: number[];
  total: number;
}

export const EMPTY = -1;
const MAX_REDUCE_PASSES = 6;

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Returns float RGB buffer (3 per pixel) after brightness/contrast/saturation. */
function adjustPixels(data: Uint8ClampedArray, adj: Adjustments): Float32Array {
  const n = data.length / 4;
  const out = new Float32Array(n * 3);
  const c = adj.contrast * 2.55;
  const cf = (259 * (c + 255)) / (255 * (259 - c));
  const bright = adj.brightness * 1.5;
  const sat = 1 + adj.saturation / 100;
  for (let i = 0; i < n; i++) {
    let r = cf * (data[i * 4]! - 128) + 128 + bright;
    let g = cf * (data[i * 4 + 1]! - 128) + 128 + bright;
    let b = cf * (data[i * 4 + 2]! - 128) + 128 + bright;
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    r = gray + (r - gray) * sat;
    g = gray + (g - gray) * sat;
    b = gray + (b - gray) * sat;
    out[i * 3] = clamp(r);
    out[i * 3 + 1] = clamp(g);
    out[i * 3 + 2] = clamp(b);
  }
  return out;
}

function borderIndices(w: number, h: number): number[] {
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
  return border;
}

/** Most common colour along the image border (after adjustments), or null if the border is transparent. */
export function detectBackground(image: ImageData, adjustments: Adjustments = DEFAULT_ADJUSTMENTS): RGB | null {
  const rgb = adjustPixels(image.data, adjustments);
  const buckets = new Map<number, [n: number, r: number, g: number, b: number]>();
  for (const i of borderIndices(image.width, image.height)) {
    if (image.data[i * 4 + 3]! < 128) continue;
    const r = rgb[i * 3]!, g = rgb[i * 3 + 1]!, b = rgb[i * 3 + 2]!;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bk = buckets.get(key);
    if (bk) {
      bk[0]++;
      bk[1] += r;
      bk[2] += g;
      bk[3] += b;
    } else {
      buckets.set(key, [1, r, g, b]);
    }
  }
  let best: [number, number, number, number] | undefined;
  for (const bk of buckets.values()) if (!best || bk[0] > best[0]) best = bk;
  return best ? [best[1] / best[0], best[2] / best[0], best[3] / best[0]] : null;
}

/**
 * Marks transparent pixels, plus pixels connected to the border that are
 * within `tolerance` of the background colour, as empty.
 */
function backgroundMask(rgb: Float32Array, image: ImageData, opts: PatternOptions): Uint8Array {
  const { width: w, height: h, data: alpha } = image;
  const n = w * h;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (alpha[i * 4 + 3]! < 128) mask[i] = 1;
  if (!opts.removeBackground) return mask;

  const bg = opts.bgColor ?? detectBackground(image, opts.adjustments);
  const bgLab = bg ? rgbToLab(...bg) : undefined;
  const tolSq = opts.bgTolerance * opts.bgTolerance;
  const isBg = (i: number) =>
    mask[i] === 1 || (bgLab !== undefined && labDistSq(rgbToLab(rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!), bgLab) <= tolSq);

  const queue: number[] = [];
  const seen = new Uint8Array(n);
  for (const i of borderIndices(w, h)) {
    if (!seen[i] && isBg(i)) {
      seen[i] = 1;
      queue.push(i);
    }
  }
  // Transparent pixels anywhere also connect background regions.
  for (let i = 0; i < n; i++) {
    if (mask[i] && !seen[i]) {
      seen[i] = 1;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!;
    mask[i] = 1;
    const x = i % w;
    const y = (i / w) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j >= 0 && !seen[j]) {
        seen[j] = 1;
        if (isBg(j)) queue.push(j);
      }
    }
  }
  return mask;
}

/** Nearest-palette lookup restricted to `allowed`, memoised per RGB value. */
function makeMatcher(palette: BeadColor[], allowed: number[], distance: (a: Lab, b: Lab) => number) {
  const cache = new Map<number, number>();
  return (r: number, g: number, b: number): number => {
    const key = ((r | 0) << 16) | ((g | 0) << 8) | (b | 0);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const lab = rgbToLab(r | 0, g | 0, b | 0);
    let bestIdx = allowed[0]!;
    let bestD = Infinity;
    for (const idx of allowed) {
      const d = distance(lab, palette[idx]!.lab);
      if (d < bestD) {
        bestD = d;
        bestIdx = idx;
      }
    }
    cache.set(key, bestIdx);
    return bestIdx;
  };
}

/**
 * Picks at most `max` palette entries: repeatedly drops the colour whose
 * pixels would be cheapest to repaint with their nearest remaining colour.
 * This keeps small-but-distinct details (eyes, outlines) better than top-N by count.
 */
function reducePalette(palette: BeadColor[], counts: number[], max: number, distance: (a: Lab, b: Lab) => number): number[] {
  const kept = counts.map((c, i) => (c > 0 ? i : -1)).filter((i) => i >= 0);
  const weight = [...counts];
  while (kept.length > max) {
    let worst = -1;
    let worstCost = Infinity;
    let worstTarget = -1;
    for (let a = 0; a < kept.length; a++) {
      const ia = kept[a]!;
      let nearest = -1;
      let nd = Infinity;
      for (let b = 0; b < kept.length; b++) {
        if (a === b) continue;
        const d = distance(palette[ia]!.lab, palette[kept[b]!]!.lab);
        if (d < nd) {
          nd = d;
          nearest = kept[b]!;
        }
      }
      const cost = weight[ia]! * nd;
      if (cost < worstCost) {
        worstCost = cost;
        worst = a;
        worstTarget = nearest;
      }
    }
    weight[worstTarget] = weight[worstTarget]! + weight[kept[worst]!]!;
    kept.splice(worst, 1);
  }
  return kept;
}

/** 8 × 8 Bayer threshold matrix, values 0–63. */
const BAYER_8 = (() => {
  let m = [[0]];
  for (let size = 1; size < 8; size *= 2) {
    m = [
      ...m.map((row) => [...row.map((v) => 4 * v), ...row.map((v) => 4 * v + 2)]),
      ...m.map((row) => [...row.map((v) => 4 * v + 3), ...row.map((v) => 4 * v + 1)]),
    ];
  }
  return m.flat();
})();

/** How far ordered dithering may push a pixel's brightness at full strength. */
const ORDERED_SPREAD = 64;

/** Maps each non-masked pixel to a palette index in `allowed`, with the chosen dithering. */
function mapPixels(
  rgb: Float32Array,
  mask: Uint8Array,
  w: number,
  h: number,
  palette: BeadColor[],
  allowed: number[],
  opts: PatternOptions,
  distance: (a: Lab, b: Lab) => number,
): Int16Array {
  const match = makeMatcher(palette, allowed, distance);
  const raw = new Int16Array(w * h).fill(EMPTY);
  const strength = Math.max(0, Math.min(100, opts.ditherStrength)) / 100;
  const mode = strength > 0 ? opts.dither : "none";
  const buf = mode === "diffusion" ? Float32Array.from(rgb) : rgb;
  const spread = (j: number, er: number, eg: number, eb: number, f: number) => {
    if (mask[j]) return;
    buf[j * 3] = buf[j * 3]! + er * f;
    buf[j * 3 + 1] = buf[j * 3 + 1]! + eg * f;
    buf[j * 3 + 2] = buf[j * 3 + 2]! + eb * f;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i]) continue;
      let r = clamp(buf[i * 3]!), g = clamp(buf[i * 3 + 1]!), b = clamp(buf[i * 3 + 2]!);
      if (mode === "ordered") {
        const t = ((BAYER_8[(y % 8) * 8 + (x % 8)]! + 0.5) / 64 - 0.5) * ORDERED_SPREAD * strength;
        r = clamp(r + t);
        g = clamp(g + t);
        b = clamp(b + t);
      }
      const idx = match(r, g, b);
      raw[i] = idx;
      if (mode !== "diffusion") continue;
      const [pr, pg, pb] = palette[idx]!.rgb;
      const er = (r - pr) * strength;
      const eg = (g - pg) * strength;
      const eb = (b - pb) * strength;
      if (x < w - 1) spread(i + 1, er, eg, eb, 7 / 16);
      if (y < h - 1) {
        if (x > 0) spread(i + w - 1, er, eg, eb, 3 / 16);
        spread(i + w, er, eg, eb, 5 / 16);
        if (x < w - 1) spread(i + w + 1, er, eg, eb, 1 / 16);
      }
    }
  }
  return raw;
}

function usageOf(raw: Int16Array, size: number): number[] {
  const usage = new Array<number>(size).fill(0);
  for (const idx of raw) if (idx !== EMPTY) usage[idx]!++;
  return usage;
}

export function generatePattern(image: ImageData, opts: PatternOptions): Pattern {
  const { width: w, height: h } = image;
  const palette = opts.palette;
  const rgb = adjustPixels(image.data, opts.adjustments);
  const mask = backgroundMask(rgb, image, opts);

  if (palette.length === 0) return fromIndices(w, h, new Int16Array(w * h).fill(EMPTY), []);

  const distance = colorDistance(opts.metric);
  const map = (allowed: number[]) => mapPixels(rgb, mask, w, h, palette, allowed, opts, distance);

  // Pass 1: match against the full palette to measure usage. With dithering on,
  // this is the dithered result, so the colours dithering mixes survive reduction.
  const usage = usageOf(
    map(palette.map((_, i) => i)),
    palette.length,
  );
  let chosen = reducePalette(palette, usage, Math.max(1, opts.maxColors), distance);
  if (chosen.length === 0) chosen = [0];

  // Pass 2: map onto the reduced palette, then drop rarely used colours and
  // remap until every colour has at least `minBeads` beads.
  let raw = map(chosen);
  for (let pass = 0; pass < MAX_REDUCE_PASSES && opts.minBeads > 1 && chosen.length > 1; pass++) {
    const counts = usageOf(raw, palette.length);
    const keep = chosen.filter((i) => counts[i]! >= opts.minBeads);
    if (keep.length === chosen.length) break;
    chosen = keep.length > 0 ? keep : [chosen.reduce((a, b) => (counts[b]! > counts[a]! ? b : a))];
    raw = map(chosen);
  }

  return fromIndices(w, h, raw, palette);
}

/** Builds a pattern from cells holding indices into `palette`, keeping only used colours sorted by count. */
export function fromIndices(w: number, h: number, raw: Int16Array, palette: BeadColor[]): Pattern {
  const usage = new Map<number, number>();
  for (const idx of raw) if (idx !== EMPTY) usage.set(idx, (usage.get(idx) ?? 0) + 1);
  const order = [...usage.entries()].sort((a, b) => b[1] - a[1]);
  const remap = new Map(order.map(([idx], i) => [idx, i]));
  const cells = new Int16Array(raw.length);
  for (let i = 0; i < raw.length; i++) cells[i] = raw[i] === EMPTY ? EMPTY : remap.get(raw[i]!)!;
  return {
    width: w,
    height: h,
    cells,
    colors: order.map(([idx]) => palette[idx]!),
    counts: order.map(([, c]) => c),
    total: order.reduce((s, [, c]) => s + c, 0),
  };
}

/** Replace colours according to `swaps` (fromId -> toId), merging duplicates. */
export function applySwaps(pattern: Pattern, swaps: Map<string, BeadColor>): Pattern {
  if (swaps.size === 0) return pattern;
  const palette: BeadColor[] = [];
  const indexOf = new Map<string, number>();
  const target = pattern.colors.map((c) => {
    const to = swaps.get(c.id) ?? c;
    if (!indexOf.has(to.id)) {
      indexOf.set(to.id, palette.length);
      palette.push(to);
    }
    return indexOf.get(to.id)!;
  });
  const raw = new Int16Array(pattern.cells.length);
  for (let i = 0; i < raw.length; i++) raw[i] = pattern.cells[i] === EMPTY ? EMPTY : target[pattern.cells[i]!]!;
  return fromIndices(pattern.width, pattern.height, raw, palette);
}

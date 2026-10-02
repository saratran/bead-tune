import { labDistSq, rgbToLab, type Lab } from "./color";
import type { BeadColor } from "./palettes";

export interface Adjustments {
  brightness: number; // -100..100
  contrast: number; // -100..100
  saturation: number; // -100..100
}

export const DEFAULT_ADJUSTMENTS: Adjustments = { brightness: 0, contrast: 0, saturation: 0 };

export interface PatternOptions {
  maxColors: number;
  dither: boolean;
  removeBackground: boolean;
  palette: BeadColor[];
  adjustments: Adjustments;
}

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

const EMPTY = -1;
const BG_TOLERANCE_SQ = 14 * 14;
const DITHER_STRENGTH = 0.85;

/** Downscale an image to `width` beads wide, keeping aspect ratio, with stepwise halving for quality. */
export function sampleImage(img: HTMLImageElement | ImageBitmap, width: number): ImageData {
  const srcW = img.width;
  const srcH = img.height;
  const height = Math.max(1, Math.round((width * srcH) / srcW));

  let cur: HTMLCanvasElement | HTMLImageElement | ImageBitmap = img;
  let curW = srcW;
  let curH = srcH;
  while (curW / 2 >= width * 2) {
    const next = document.createElement("canvas");
    next.width = Math.round(curW / 2);
    next.height = Math.round(curH / 2);
    const ctx = next.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(cur, 0, 0, next.width, next.height);
    cur = next;
    curW = next.width;
    curH = next.height;
  }

  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(cur, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

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

/**
 * Marks transparent pixels and pixels connected to the border that match the
 * dominant border colour as empty.
 */
function backgroundMask(rgb: Float32Array, alpha: Uint8ClampedArray, w: number, h: number, remove: boolean): Uint8Array {
  const n = w * h;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (alpha[i * 4 + 3]! < 128) mask[i] = 1;
  if (!remove) return mask;

  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);

  // Dominant border colour via coarse buckets.
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (const i of border) {
    if (mask[i]) continue;
    const r = rgb[i * 3]!, g = rgb[i * 3 + 1]!, b = rgb[i * 3 + 2]!;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bk = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bk.n++;
    bk.r += r;
    bk.g += g;
    bk.b += b;
    buckets.set(key, bk);
  }
  let best: { n: number; r: number; g: number; b: number } | undefined;
  for (const bk of buckets.values()) if (!best || bk.n > best.n) best = bk;

  const queue: number[] = [];
  const seen = new Uint8Array(n);
  for (const i of border) {
    if (mask[i]) {
      seen[i] = 1;
      queue.push(i);
    }
  }
  let bgLab: Lab | undefined;
  if (best) {
    bgLab = rgbToLab(best.r / best.n, best.g / best.n, best.b / best.n);
  }
  const isBg = (i: number) =>
    mask[i] === 1 || (bgLab !== undefined && labDistSq(rgbToLab(rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!), bgLab) < BG_TOLERANCE_SQ);

  for (const i of border) {
    if (!seen[i] && isBg(i)) {
      seen[i] = 1;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!;
    mask[i] = 1;
    const x = i % w;
    const y = (i / w) | 0;
    const neighbours = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const j of neighbours) {
      if (j >= 0 && !seen[j]) {
        seen[j] = 1;
        if (isBg(j)) queue.push(j);
      }
    }
  }
  return mask;
}

/** Nearest-palette lookup restricted to `allowed`, memoised per quantised RGB. */
function makeMatcher(palette: BeadColor[], allowed: number[]) {
  const cache = new Map<number, number>();
  return (r: number, g: number, b: number): number => {
    const key = ((r | 0) << 16) | ((g | 0) << 8) | (b | 0);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const lab = rgbToLab(r, g, b);
    let bestIdx = allowed[0]!;
    let bestD = Infinity;
    for (const idx of allowed) {
      const d = labDistSq(lab, palette[idx]!.lab);
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
function reducePalette(palette: BeadColor[], counts: number[], max: number): number[] {
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
        const d = labDistSq(palette[ia]!.lab, palette[kept[b]!]!.lab);
        if (d < nd) {
          nd = d;
          nearest = kept[b]!;
        }
      }
      const cost = weight[ia]! * Math.sqrt(nd);
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

/** Maps each non-masked pixel to a palette index in `allowed`, optionally with Floyd–Steinberg diffusion. */
function mapPixels(
  rgb: Float32Array,
  mask: Uint8Array,
  w: number,
  h: number,
  palette: BeadColor[],
  allowed: number[],
  dither: boolean,
): Int16Array {
  const match = makeMatcher(palette, allowed);
  const raw = new Int16Array(w * h).fill(EMPTY);
  const buf = dither ? Float32Array.from(rgb) : rgb;
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
      const r = clamp(buf[i * 3]!), g = clamp(buf[i * 3 + 1]!), b = clamp(buf[i * 3 + 2]!);
      const idx = match(r, g, b);
      raw[i] = idx;
      if (!dither) continue;
      const [pr, pg, pb] = palette[idx]!.rgb;
      const er = (r - pr) * DITHER_STRENGTH;
      const eg = (g - pg) * DITHER_STRENGTH;
      const eb = (b - pb) * DITHER_STRENGTH;
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

export function generatePattern(image: ImageData, opts: PatternOptions): Pattern {
  const { width: w, height: h, data } = image;
  const n = w * h;
  const palette = opts.palette;
  const rgb = adjustPixels(data, opts.adjustments);
  const mask = backgroundMask(rgb, data, w, h, opts.removeBackground);

  if (palette.length === 0) {
    return { width: w, height: h, cells: new Int16Array(n).fill(EMPTY), colors: [], counts: [], total: 0 };
  }

  // Pass 1: match against the full palette to measure usage. With dithering on,
  // measure the dithered result too, so the colours dithering mixes survive reduction.
  const all = palette.map((_, i) => i);
  const usage = new Array<number>(palette.length).fill(0);
  for (const idx of mapPixels(rgb, mask, w, h, palette, all, opts.dither)) {
    if (idx !== EMPTY) usage[idx] = usage[idx]! + 1;
  }
  const chosen = reducePalette(palette, usage, Math.max(1, opts.maxColors));
  if (chosen.length === 0) chosen.push(0);

  // Pass 2: map onto the reduced palette.
  return compact(w, h, mapPixels(rgb, mask, w, h, palette, chosen, opts.dither), palette);
}

/** Re-index cells from palette indices to a sorted list of only the used colours. */
function compact(w: number, h: number, raw: Int16Array, palette: BeadColor[]): Pattern {
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
  return compact(pattern.width, pattern.height, raw, palette);
}

/**
 * Turning a source image into one pixel per bead.
 *
 * Everything except `canvasSource` is pure and works on plain ImageData-shaped
 * objects, so it can be tested without a browser.
 */

export type SamplingMode = "smooth" | "sharp" | "pixelart";

/** Part of the source image, as fractions (0–1) of its width and height. */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_CROP: Crop = { x: 0, y: 0, w: 1, h: 1 };

export interface ImageSource {
  width: number;
  height: number;
  /** The `crop` area resized to exactly `w` × `h` pixels (area-averaged). */
  scaled(w: number, h: number, crop: Crop): ImageData;
  /** Pixels at original resolution (large images may be reduced). */
  native(): ImageData;
}

export function makeImageData(width: number, height: number, data = new Uint8ClampedArray(width * height * 4)): ImageData {
  return { width, height, data, colorSpace: "srgb" } as ImageData;
}

const OPAQUE = 128;

/** Averages each `k` × `k` block. Colour ignores transparent pixels; alpha is the opaque share. */
export function blockAverage(src: ImageData, k: number): ImageData {
  if (k === 1) return src;
  const w = Math.floor(src.width / k);
  const h = Math.floor(src.height / k);
  const out = makeImageData(w, h);
  const d = src.data;
  for (let by = 0; by < h; by++) {
    for (let bx = 0; bx < w; bx++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = by * k; y < by * k + k; y++) {
        for (let x = bx * k; x < bx * k + k; x++) {
          const i = (y * src.width + x) * 4;
          if (d[i + 3]! < OPAQUE) continue;
          r += d[i]!;
          g += d[i + 1]!;
          b += d[i + 2]!;
          n++;
        }
      }
      const o = (by * w + bx) * 4;
      if (n > 0) out.data.set([r / n, g / n, b / n, (255 * n) / (k * k)], o);
    }
  }
  return out;
}

/**
 * Colour of the most common colour group in a rectangle, or null if it's
 * mostly transparent. Groups are coarse (16 levels per channel) so slight
 * noise still counts as the same colour; the result is that group's average.
 */
function dominantColor(src: ImageData, x0: number, y0: number, x1: number, y1: number): [number, number, number] | null {
  const groups = new Map<number, [n: number, r: number, g: number, b: number]>();
  const d = src.data;
  let opaque = 0;
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * src.width + x) * 4;
      total++;
      if (d[i + 3]! < OPAQUE) continue;
      opaque++;
      const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const grp = groups.get(key);
      if (grp) {
        grp[0]++;
        grp[1] += r;
        grp[2] += g;
        grp[3] += b;
      } else {
        groups.set(key, [1, r, g, b]);
      }
    }
  }
  if (opaque * 2 < total) return null;
  let best: [number, number, number, number] | undefined;
  for (const grp of groups.values()) if (!best || grp[0] > best[0]) best = grp;
  return [best![1] / best![0], best![2] / best![0], best![3] / best![0]];
}

/** Sharp sampling: each `k` × `k` block takes its dominant colour, so edges don't blend. */
export function blockMode(src: ImageData, k: number): ImageData {
  if (k === 1) return src;
  const w = Math.floor(src.width / k);
  const h = Math.floor(src.height / k);
  const out = makeImageData(w, h);
  for (let by = 0; by < h; by++) {
    for (let bx = 0; bx < w; bx++) {
      const c = dominantColor(src, bx * k, by * k, bx * k + k, by * k + k);
      if (c) out.data.set([...c, 255], (by * w + bx) * 4);
    }
  }
  return out;
}

/** 3 × 3 median per channel: removes speckle and grain while keeping edges. Alpha is kept. */
export function medianFilter(src: ImageData): ImageData {
  const { width: w, height: h, data: d } = src;
  const out = makeImageData(w, h, new Uint8ClampedArray(d));
  const win = new Uint8Array(9);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(w - 1, Math.max(0, x + dx));
            win[n++] = d[(yy * w + xx) * 4 + c]!;
          }
        }
        win.sort();
        out.data[(y * w + x) * 4 + c] = win[4]!;
      }
    }
  }
  return out;
}

export interface PixelGrid {
  /** Size of one art pixel in source pixels (1 = no grid found). */
  scale: number;
  offsetX: number;
  offsetY: number;
  cols: number;
  rows: number;
}

/** Max per-channel difference still treated as "the same colour" (absorbs JPEG noise). */
const SAME_COLOR = 24;

function samePixel(d: Uint8ClampedArray, i: number, j: number): boolean {
  const ta = d[i + 3]! < OPAQUE;
  if (ta || d[j + 3]! < OPAQUE) return ta === d[j + 3]! < OPAQUE;
  return Math.abs(d[i]! - d[j]!) <= SAME_COLOR && Math.abs(d[i + 1]! - d[j + 1]!) <= SAME_COLOR && Math.abs(d[i + 2]! - d[j + 2]!) <= SAME_COLOR;
}

/** Positions along each scanned line where the colour changes (between p-1 and p). */
function edges(src: ImageData, horizontal: boolean): { lengths: number[]; boundaries: number[] } {
  const { width: w, height: h, data: d } = src;
  const lines = horizontal ? h : w;
  const len = horizontal ? w : h;
  const step = Math.max(1, Math.floor(lines / 64)); // a sample of lines is plenty
  const lengths: number[] = [];
  const boundaries: number[] = [];
  for (let l = 0; l < lines; l += step) {
    const at = (p: number) => (horizontal ? (l * w + p) * 4 : (p * w + l) * 4);
    let start = -1; // first run touches the edge, so its length is unknown
    for (let p = 1; p < len; p++) {
      if (samePixel(d, at(p - 1), at(p))) continue;
      boundaries.push(p);
      if (start >= 0) lengths.push(p - start);
      start = p;
    }
  }
  return { lengths, boundaries };
}

function mostCommonRemainder(values: number[], s: number): number {
  const counts = new Array<number>(s).fill(0);
  for (const v of values) counts[v % s]!++;
  return counts.indexOf(Math.max(...counts));
}

/**
 * Finds the pixel size of enlarged pixel art: the largest scale that (nearly)
 * every run of same-coloured pixels is a multiple of.
 */
export function detectPixelGrid(src: ImageData): PixelGrid {
  const h = edges(src, true);
  const v = edges(src, false);
  const lengths = [...h.lengths, ...v.lengths];
  let scale = 1;
  if (lengths.length >= 4) {
    const maxScale = Math.min(64, Math.floor(Math.min(src.width, src.height) / 2));
    for (let s = maxScale; s >= 2; s--) {
      const fit = lengths.filter((n) => n % s === 0).length / lengths.length;
      if (fit >= 0.9) {
        scale = s;
        break;
      }
    }
  }
  const offsetX = scale > 1 ? mostCommonRemainder(h.boundaries, scale) : 0;
  const offsetY = scale > 1 ? mostCommonRemainder(v.boundaries, scale) : 0;
  return {
    scale,
    offsetX,
    offsetY,
    cols: Math.floor((src.width - offsetX) / scale),
    rows: Math.floor((src.height - offsetY) / scale),
  };
}

/** One output pixel per art pixel, using the dominant colour of each cell. */
export function pixelArtGrid(src: ImageData, g: PixelGrid): ImageData {
  const out = makeImageData(g.cols, g.rows);
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const x0 = g.offsetX + c * g.scale;
      const y0 = g.offsetY + r * g.scale;
      // Ignore a 1px border inside each cell where enlargement may have blurred.
      const inset = g.scale >= 4 ? 1 : 0;
      const color = dominantColor(src, x0 + inset, y0 + inset, x0 + g.scale - inset, y0 + g.scale - inset);
      if (color) out.data.set([...color, 255], (r * g.cols + c) * 4);
    }
  }
  return out;
}

/** Extra resolution sampled per bead, so Sharp mode and noise smoothing have pixels to work with. */
const OVERSAMPLE = 4;

/** Samples `crop` of the source to `width` beads wide, keeping the aspect ratio. */
export function sampleGrid(source: ImageSource, width: number, crop: Crop, mode: "smooth" | "sharp", denoise: boolean): ImageData {
  const cropW = source.width * crop.w;
  const cropH = source.height * crop.h;
  const height = Math.max(1, Math.round((width * cropH) / cropW));
  const k = Math.max(1, Math.min(OVERSAMPLE, Math.floor(cropW / width)));
  let hi = source.scaled(width * k, height * k, crop);
  if (denoise) hi = medianFilter(hi);
  return mode === "sharp" ? blockMode(hi, k) : blockAverage(hi, k);
}

/** An ImageSource over in-memory pixels; `scaled` uses area averaging. */
export function imageDataSource(src: ImageData): ImageSource {
  return {
    width: src.width,
    height: src.height,
    native: () => src,
    scaled(w, h, crop) {
      const out = makeImageData(w, h);
      const sx = src.width * crop.x;
      const sy = src.height * crop.y;
      const fx = (src.width * crop.w) / w;
      const fy = (src.height * crop.h) / h;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const x0 = Math.floor(sx + x * fx);
          const y0 = Math.floor(sy + y * fy);
          const x1 = Math.max(x0 + 1, Math.floor(sx + (x + 1) * fx));
          const y1 = Math.max(y0 + 1, Math.floor(sy + (y + 1) * fy));
          let r = 0, g = 0, b = 0, a = 0, n = 0;
          for (let yy = y0; yy < Math.min(y1, src.height); yy++) {
            for (let xx = x0; xx < Math.min(x1, src.width); xx++) {
              const i = (yy * src.width + xx) * 4;
              r += src.data[i]!;
              g += src.data[i + 1]!;
              b += src.data[i + 2]!;
              a += src.data[i + 3]!;
              n++;
            }
          }
          if (n) out.data.set([r / n, g / n, b / n, a / n], (y * w + x) * 4);
        }
      }
      return out;
    },
  };
}

const MAX_NATIVE_SIDE = 4096;
const CACHE_SIZE = 8;

/** An ImageSource backed by a decoded image, resized with the canvas (browser only). */
export function canvasSource(img: HTMLImageElement | ImageBitmap): ImageSource {
  const cache = new Map<string, ImageData>();
  const remember = (key: string, make: () => ImageData) => {
    const hit = cache.get(key);
    if (hit) return hit;
    const value = make();
    cache.set(key, value);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
    return value;
  };

  const canvas = (w: number, h: number) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = "high";
    return { c, ctx };
  };

  return {
    width: img.width,
    height: img.height,
    scaled: (w, h, crop) =>
      remember(`${w}x${h}@${crop.x},${crop.y},${crop.w},${crop.h}`, () => {
        // Halve in steps first: a single big downscale skips pixels and aliases.
        let cur: CanvasImageSource = img;
        let sx = img.width * crop.x;
        let sy = img.height * crop.y;
        let sw = img.width * crop.w;
        let sh = img.height * crop.h;
        while (sw / 2 >= w * 2) {
          const next = canvas(Math.round(sw / 2), Math.round(sh / 2));
          next.ctx.drawImage(cur, sx, sy, sw, sh, 0, 0, next.c.width, next.c.height);
          cur = next.c;
          sx = 0;
          sy = 0;
          sw = next.c.width;
          sh = next.c.height;
        }
        const out = canvas(w, h);
        out.ctx.drawImage(cur, sx, sy, sw, sh, 0, 0, w, h);
        return out.ctx.getImageData(0, 0, w, h);
      }),
    native: () =>
      remember("native", () => {
        const f = Math.min(1, MAX_NATIVE_SIDE / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * f));
        const h = Math.max(1, Math.round(img.height * f));
        const out = canvas(w, h);
        out.ctx.imageSmoothingEnabled = false; // keep pixel-art edges hard
        out.ctx.drawImage(img, 0, 0, w, h);
        return out.ctx.getImageData(0, 0, w, h);
      }),
  };
}

/** Crop rectangles as fractions (0–1) of an image's width and height. */
import { FULL_CROP, makeImageData, type Crop } from "./sampling";

export type CropHandle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Smallest crop side, as a fraction of the image. */
export const MIN_CROP = 0.02;

export function isFullCrop(c: Crop): boolean {
  return c.x <= 1e-6 && c.y <= 1e-6 && c.w >= 1 - 1e-6 && c.h >= 1 - 1e-6;
}

/** Keeps the crop inside the image and at least MIN_CROP in each direction. */
export function clampCrop(c: Crop): Crop {
  const w = Math.min(1, Math.max(MIN_CROP, c.w));
  const h = Math.min(1, Math.max(MIN_CROP, c.h));
  return { x: Math.min(1 - w, Math.max(0, c.x)), y: Math.min(1 - h, Math.max(0, c.y)), w, h };
}

/** `inner` is relative to `outer`; returns it relative to the whole image. */
export function composeCrop(outer: Crop, inner: Crop): Crop {
  return { x: outer.x + inner.x * outer.w, y: outer.y + inner.y * outer.h, w: inner.w * outer.w, h: inner.h * outer.h };
}

/**
 * Applies a drag of (dx, dy) — in image fractions — to `start` using `handle`.
 * With `aspect` (crop width / height in pixels), edges keep that pixel ratio;
 * `imageAspect` is the image's width / height, needed to convert.
 */
export function dragCrop(start: Crop, handle: CropHandle, dx: number, dy: number, aspect?: number, imageAspect = 1): Crop {
  if (handle === "move") {
    return clampCrop({ ...start, x: Math.min(1 - start.w, Math.max(0, start.x + dx)), y: Math.min(1 - start.h, Math.max(0, start.y + dy)) });
  }
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (handle.includes("w")) left = Math.min(right - MIN_CROP, Math.max(0, left + dx));
  if (handle.includes("e")) right = Math.max(left + MIN_CROP, Math.min(1, right + dx));
  if (handle.includes("n")) top = Math.min(bottom - MIN_CROP, Math.max(0, top + dy));
  if (handle.includes("s")) bottom = Math.max(top + MIN_CROP, Math.min(1, bottom + dy));
  let c = { x: left, y: top, w: right - left, h: bottom - top };

  if (aspect) {
    // Fraction-space ratio h/w that gives `aspect` in pixels.
    const ratio = imageAspect / aspect;
    const vertical = handle === "n" || handle === "s";
    let w = vertical ? c.h / ratio : c.w;
    let h = w * ratio;
    // Shrink to fit inside the image from the fixed corner/edge.
    const maxW = handle.includes("w") ? right : handle.includes("e") ? 1 - left : Math.min(c.x + c.w / 2, 1 - (c.x + c.w / 2)) * 2;
    const maxH = handle.includes("n") ? bottom : handle.includes("s") ? 1 - top : Math.min(c.y + c.h / 2, 1 - (c.y + c.h / 2)) * 2;
    const scale = Math.min(1, maxW / w, maxH / h);
    w *= scale;
    h *= scale;
    const x = handle.includes("w") ? right - w : handle.includes("e") ? left : c.x + (c.w - w) / 2;
    const y = handle.includes("n") ? bottom - h : handle.includes("s") ? top : c.y + (c.h - h) / 2;
    c = { x, y, w, h };
  }
  return clampCrop(c);
}

/** The largest crop with the given pixel aspect (width / height), centred. */
export function centredCrop(aspect: number, imageAspect: number): Crop {
  const ratio = imageAspect / aspect; // fraction h per fraction w
  const w = ratio <= 1 ? 1 : 1 / ratio;
  const h = w * ratio;
  return clampCrop({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
}

/** Pixel rectangle of a crop on an image of `width` × `height`. */
export function cropPixels(c: Crop, width: number, height: number) {
  const x = Math.round(c.x * width);
  const y = Math.round(c.y * height);
  const w = Math.max(1, Math.round((c.x + c.w) * width) - x);
  const h = Math.max(1, Math.round((c.y + c.h) * height) - y);
  return { x, y, w, h };
}

/** Copies the cropped part of `src`. */
export function cropImageData(src: ImageData, c: Crop): ImageData {
  if (isFullCrop(c)) return src;
  const r = cropPixels(c, src.width, src.height);
  const out = makeImageData(r.w, r.h);
  for (let y = 0; y < r.h; y++) {
    const from = ((r.y + y) * src.width + r.x) * 4;
    out.data.set(src.data.subarray(from, from + r.w * 4), y * r.w * 4);
  }
  return out;
}

export { FULL_CROP };

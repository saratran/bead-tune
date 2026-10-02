/** The full image → bead pattern pipeline, in order. */
import { addOutline, contentBox, padPattern, removeStrays, trimPattern } from "./cleanup";
import { composeCrop, cropImageData } from "./crop";
import type { BeadColor } from "./palettes";
import { detectBackground, generatePattern, type Pattern, type PatternOptions } from "./pattern";
import { detectPixelGrid, FULL_CROP, pixelArtGrid, sampleGrid, type Crop, type ImageSource, type PixelGrid, type SamplingMode } from "./sampling";

export interface PipelineSettings {
  /** Target width in beads (ignored for detected pixel art, which keeps its own size). */
  width: number;
  /** Part of the source image to use (fractions); the whole image when omitted. */
  crop?: Crop;
  sampling: SamplingMode;
  /** Median-filter the image before sampling, to calm photo noise. */
  denoise: boolean;
  /** Crop away empty space around the subject so the width is spent on it. */
  trim: boolean;
  /** Groups of up to this many beads get absorbed by their surroundings (0 = off). */
  cleanup: number;
  /** One-bead outline colour around the subject, or null for none. */
  outline: BeadColor | null;
  /**
   * Leave the outline's one-bead margin but don't draw it — the app adds the
   * outline itself after colour swaps and hand edits.
   */
  reserveOutline?: boolean;
  options: PatternOptions;
}

export interface PipelineResult {
  pattern: Pattern;
  /** Set when sampling is "pixelart": the grid that was found. */
  pixelGrid?: PixelGrid;
  /** Pixel art mode found no usable grid and fell back to sharp sampling. */
  pixelArtFallback?: boolean;
  /**
   * Where the final pattern came from (not set for pixel art): the area of the
   * source and grid width that were sampled, and the offset of that grid inside
   * the final pattern (after trim and outline). Pattern cell (x, y) corresponds
   * to grid cell (x - offsetX, y - offsetY).
   */
  sampled?: { crop: Crop; width: number; offsetX: number; offsetY: number };
}

/** Above this, a "detected" pixel grid is almost certainly a photo, not pixel art. */
export const MAX_PIXEL_ART_SIDE = 300;

export function buildPattern(source: ImageSource, s: PipelineSettings): PipelineResult {
  const userCrop = s.crop ?? FULL_CROP;
  // The outline adds one bead on each side; keep the final width as requested.
  const inner = Math.max(1, s.outline || s.reserveOutline ? s.width - 2 : s.width);
  let options = s.options;
  const result: PipelineResult = { pattern: undefined! };

  let pattern: Pattern | undefined;
  if (s.sampling === "pixelart") {
    const native = cropImageData(source.native(), userCrop);
    const grid = detectPixelGrid(native);
    result.pixelGrid = grid;
    if (grid.scale > 1 && grid.cols <= MAX_PIXEL_ART_SIDE && grid.rows <= MAX_PIXEL_ART_SIDE) {
      pattern = generatePattern(pixelArtGrid(native, grid), options);
      if (s.trim) pattern = trimPattern(pattern);
    } else {
      result.pixelArtFallback = true;
    }
  }

  if (!pattern) {
    const mode = s.sampling === "smooth" ? "smooth" : "sharp";
    const sample = (crop: Crop) => sampleGrid(source, inner, crop, mode, s.denoise);
    const first = sample(userCrop);
    let sampled = { crop: userCrop, width: inner, offsetX: 0, offsetY: 0 };
    if (options.removeBackground && !options.bgColor) {
      // Pin the background colour now: after cropping, the subject may touch the border.
      options = { ...options, bgColor: detectBackground(first, options.adjustments) };
    }
    pattern = generatePattern(first, options);

    const box = s.trim ? contentBox(pattern) : null;
    if (box && (box.w < pattern.width || box.h < pattern.height)) {
      // Re-sample just the subject (plus a bead of margin so background removal
      // still has a border to start from), then trim the margin off.
      const x0 = Math.max(0, box.x - 1);
      const y0 = Math.max(0, box.y - 1);
      const x1 = Math.min(pattern.width, box.x + box.w + 1);
      const y1 = Math.min(pattern.height, box.y + box.h + 1);
      // The trim box is relative to the user's crop; combine them.
      const crop = composeCrop(userCrop, { x: x0 / pattern.width, y: y0 / pattern.height, w: (x1 - x0) / pattern.width, h: (y1 - y0) / pattern.height });
      // Size the sample so the subject (not subject + margin) ends up `inner` beads wide.
      // The first estimate comes from a coarse grid, so measure again and correct once.
      const clampWidth = (n: number) => Math.max(1, Math.min(MAX_PIXEL_ART_SIDE, Math.round(n)));
      let sampleWidth = clampWidth((inner * (x1 - x0)) / box.w);
      for (let attempt = 0; attempt < 2; attempt++) {
        pattern = generatePattern(sampleGrid(source, sampleWidth, crop, mode, s.denoise), options);
        sampled = { crop, width: sampleWidth, offsetX: 0, offsetY: 0 };
        const subject = contentBox(pattern);
        if (!subject || subject.w === inner) break;
        const next = clampWidth((sampleWidth * inner) / subject.w);
        if (next === sampleWidth) break;
        sampleWidth = next;
      }
    }
    if (s.trim) {
      const trimBox = contentBox(pattern);
      if (trimBox) sampled = { ...sampled, offsetX: -trimBox.x, offsetY: -trimBox.y };
      pattern = trimPattern(pattern);
    }
    result.sampled = sampled;
  }

  if (s.cleanup > 0) pattern = removeStrays(pattern, s.cleanup);
  if (s.outline || s.reserveOutline) {
    pattern = padPattern(pattern, 1);
    if (s.outline) pattern = addOutline(pattern, s.outline);
    if (result.sampled) result.sampled = { ...result.sampled, offsetX: result.sampled.offsetX + 1, offsetY: result.sampled.offsetY + 1 };
  }
  result.pattern = pattern;
  return result;
}

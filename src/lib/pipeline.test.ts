import { describe, expect, test } from "bun:test";
import { contentBox } from "./cleanup";
import { BRANDS } from "./palettes";
import { DEFAULT_PATTERN_OPTIONS } from "./pattern";
import { buildPattern, type PipelineSettings } from "./pipeline";
import { imageDataSource, makeImageData } from "./sampling";

type Px = [number, number, number, number];

const palette = BRANDS.find((b) => b.id === "mard-221")!.colors;
const nearestHex = (rgb: number[]) =>
  palette.reduce((best, c) =>
    Math.hypot(...c.rgb.map((v, i) => v - rgb[i]!)) < Math.hypot(...best.rgb.map((v, i) => v - rgb[i]!)) ? c : best,
  );

function source(w: number, h: number, px: (x: number, y: number) => Px) {
  const img = makeImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.data.set(px(x, y), (y * w + x) * 4);
  return imageDataSource(img);
}

const RED: Px = [200, 30, 40, 255];
const WHITE: Px = [255, 255, 255, 255];

/** A red square from (x0,y0) to (x1,y1) on white, 160 × 160 px. */
const square = (x0 = 50, y0 = 50, x1 = 110, y1 = 110) => source(160, 160, (x, y) => (x >= x0 && x < x1 && y >= y0 && y < y1 ? RED : WHITE));

const base: PipelineSettings = {
  width: 20,
  sampling: "smooth",
  denoise: false,
  trim: false,
  cleanup: 0,
  outline: null,
  options: { ...DEFAULT_PATTERN_OPTIONS, palette },
};
const withBg = { ...base.options, removeBackground: true };

test("defaults give a pattern of the requested width", () => {
  const { pattern } = buildPattern(square(), base);
  expect([pattern.width, pattern.height]).toEqual([20, 20]);
  expect(pattern.total).toBe(400);
});

test("sharp sampling avoids the blended edge colours smooth sampling makes", () => {
  // Square edges at 52/108 px fall inside beads (8 px each).
  const src = square(52, 52, 108, 108);
  const smooth = buildPattern(src, base).pattern;
  const sharp = buildPattern(src, { ...base, sampling: "sharp" }).pattern;
  expect(sharp.colors.map((c) => c.id).sort()).toEqual([nearestHex(RED).id, nearestHex(WHITE).id].sort());
  expect(smooth.colors.length).toBeGreaterThan(2);
});

describe("trim", () => {
  test("crops to the subject and spends the width on it", () => {
    const untrimmed = buildPattern(square(), { ...base, options: withBg }).pattern;
    const trimmed = buildPattern(square(), { ...base, trim: true, options: withBg }).pattern;
    expect(untrimmed.width).toBe(20);
    expect(contentBox(untrimmed)!.w).toBeLessThan(10);
    expect(contentBox(trimmed)).toEqual({ x: 0, y: 0, w: trimmed.width, h: trimmed.height });
    expect(trimmed.width).toBeGreaterThanOrEqual(18);
    expect(trimmed.width).toBeLessThanOrEqual(20);
  });

  test("keeps a subject that touches the image edge", () => {
    // The original border is mostly white, but after cropping it's mostly red.
    // The background colour detected first (white) must still be the one removed.
    const src = square(0, 0, 110, 110);
    const { pattern } = buildPattern(src, { ...base, sampling: "sharp", trim: true, options: withBg });
    expect(pattern.colors).toEqual([nearestHex(RED)]);
    expect(pattern.total).toBe(pattern.width * pattern.height);
    expect(pattern.width).toBeGreaterThanOrEqual(18);
  });

  test("trims transparent images without background removal", () => {
    const src = source(100, 100, (x, y) => (x >= 30 && x < 70 && y >= 30 && y < 70 ? RED : [0, 0, 0, 0]));
    const { pattern } = buildPattern(src, { ...base, trim: true });
    expect(contentBox(pattern)).toEqual({ x: 0, y: 0, w: pattern.width, h: pattern.height });
    expect(pattern.width).toBeGreaterThan(15);
  });
});

test("outline keeps the requested width and surrounds the subject", () => {
  const black = palette.reduce((a, b) => (b.lab[0] < a.lab[0] ? b : a));
  const { pattern } = buildPattern(square(), { ...base, sampling: "sharp", trim: true, outline: black, options: withBg });
  expect(pattern.width).toBeLessThanOrEqual(20);
  expect(pattern.width).toBeGreaterThanOrEqual(18);
  // Every edge cell of a trimmed + outlined (crisp) square is outline.
  const edge = [...Array(pattern.width).keys()].map((x) => pattern.cells[x]);
  expect(edge.every((idx) => pattern.colors[idx!] === black)).toBe(true);
});

test("cleanup removes speckle", () => {
  // White with a few single dark pixels at bead resolution.
  const specks = source(20, 20, (x, y) => ((x * 7 + y * 3) % 23 === 0 ? [30, 30, 30, 255] : WHITE));
  const raw = buildPattern(specks, base).pattern;
  const clean = buildPattern(specks, { ...base, cleanup: 1 }).pattern;
  expect(raw.colors.length).toBe(2);
  expect(clean.colors.length).toBe(1);
});

test("noise smoothing removes isolated specks before sampling", () => {
  // 80 px wide → 4 px per bead; one bright pixel per bead would tint every bead.
  const src = source(80, 80, (x, y) => (x % 4 === 1 && y % 4 === 1 ? WHITE : RED));
  const noisy = buildPattern(src, base).pattern;
  const smoothed = buildPattern(src, { ...base, denoise: true }).pattern;
  expect(smoothed.colors).toEqual([nearestHex(RED)]);
  expect(noisy.colors[0]).not.toBe(nearestHex(RED));
});

describe("pixel art", () => {
  // 8 × 8 art using chart colours, enlarged 5×.
  const art = (c: number, r: number) => palette[(c * 3 + r * 5) % 12]!;
  const enlarged = source(40, 40, (x, y) => [...art(Math.floor(x / 5), Math.floor(y / 5)).rgb, 255] as Px);

  test("reproduces the art bead for bead, ignoring the width setting", () => {
    const { pattern, pixelGrid, pixelArtFallback } = buildPattern(enlarged, { ...base, width: 52, sampling: "pixelart" });
    expect(pixelArtFallback).toBeUndefined();
    expect(pixelGrid).toMatchObject({ scale: 5, cols: 8, rows: 8 });
    expect([pattern.width, pattern.height]).toEqual([8, 8]);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) expect(pattern.colors[pattern.cells[r * 8 + c]!]).toBe(art(c, r));
  });

  test("falls back to sharp sampling when there is no pixel grid", () => {
    let seed = 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647) % 256;
    const photo = source(120, 120, () => [rnd(), rnd(), rnd(), 255]);
    const { pattern, pixelArtFallback } = buildPattern(photo, { ...base, sampling: "pixelart" });
    expect(pixelArtFallback).toBe(true);
    expect(pattern.width).toBe(20);
  });
});

describe("crop", () => {
  // Left half red, right half white.
  const halves = source(160, 80, (x) => (x < 80 ? RED : WHITE));

  test("samples only the cropped area, keeping its aspect ratio", () => {
    const { pattern } = buildPattern(halves, { ...base, crop: { x: 0.5, y: 0, w: 0.5, h: 1 } });
    expect([pattern.width, pattern.height]).toEqual([20, 20]);
    expect(pattern.colors).toEqual([nearestHex(WHITE)]);
  });

  test("trim works inside the crop", () => {
    // Crop the right 3/4: red strip on the left, white background to remove and trim.
    const { pattern } = buildPattern(halves, {
      ...base,
      sampling: "sharp",
      trim: true,
      crop: { x: 0.25, y: 0, w: 0.75, h: 1 },
      options: withBg,
    });
    expect(pattern.colors).toEqual([nearestHex(RED)]);
    expect(pattern.total).toBe(pattern.width * pattern.height);
  });

  test("pixel art uses only the cropped pixels", () => {
    const art = (c: number, r: number) => palette[(c * 3 + r * 5) % 12]!;
    const enlarged = source(40, 40, (x, y) => [...art(Math.floor(x / 5), Math.floor(y / 5)).rgb, 255] as Px);
    const { pattern } = buildPattern(enlarged, { ...base, sampling: "pixelart", crop: { x: 0.5, y: 0, w: 0.5, h: 0.5 } });
    expect([pattern.width, pattern.height]).toEqual([4, 4]);
    expect(pattern.colors[pattern.cells[0]!]).toBe(art(4, 0));
  });
});

test("reserveOutline leaves the margin without drawing the outline", () => {
  const black = palette.reduce((a, b) => (b.lab[0] < a.lab[0] ? b : a));
  const drawn = buildPattern(square(), { ...base, sampling: "sharp", trim: true, outline: black, options: withBg }).pattern;
  const reserved = buildPattern(square(), { ...base, sampling: "sharp", trim: true, outline: null, reserveOutline: true, options: withBg }).pattern;
  expect([reserved.width, reserved.height]).toEqual([drawn.width, drawn.height]);
  expect(reserved.colors.some((c) => c.id === black.id)).toBe(false);
  expect(reserved.cells[0]).toBe(-1); // the margin is empty
});

import { expect, test } from "bun:test";
import { BRANDS } from "./palettes";
import { applySwaps, DEFAULT_ADJUSTMENTS, generatePattern } from "./pattern";

const palette = BRANDS[0]!.colors.filter((c) => c.kind === "solid");

function image(w: number, h: number, px: (x: number, y: number) => [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(px(x, y), (y * w + x) * 4);
  return { width: w, height: h, data, colorSpace: "srgb" } as ImageData;
}

const opts = { palette, maxColors: 24, dither: false, removeBackground: false, adjustments: DEFAULT_ADJUSTMENTS };

test("maps pure colours to the closest bead", () => {
  const p = generatePattern(image(2, 1, (x) => (x === 0 ? [255, 255, 255, 255] : [20, 20, 20, 255])), opts);
  expect(p.colors.map((c) => c.name).sort()).toEqual(["Black", "White"]);
  expect(p.total).toBe(2);
});

test("respects the colour limit", () => {
  const img = image(30, 30, (x, y) => [x * 8, y * 8, (x + y) * 4, 255]);
  const p = generatePattern(img, { ...opts, maxColors: 5 });
  expect(p.colors.length).toBeLessThanOrEqual(5);
  expect(p.total).toBe(900);
});

test("transparent pixels and background are left empty", () => {
  const transparent = generatePattern(image(3, 3, (x, y) => (x === 1 && y === 1 ? [200, 0, 0, 255] : [0, 0, 0, 0])), opts);
  expect(transparent.total).toBe(1);

  const bg = image(5, 5, (x, y) => (x >= 1 && x <= 3 && y >= 1 && y <= 3 ? [200, 30, 50, 255] : [255, 255, 255, 255]));
  expect(generatePattern(bg, { ...opts, removeBackground: true }).total).toBe(9);
});

test("swaps merge colours", () => {
  const p = generatePattern(image(2, 1, (x) => (x === 0 ? [255, 255, 255, 255] : [20, 20, 20, 255])), opts);
  const white = p.colors.find((c) => c.name === "White")!;
  const black = p.colors.find((c) => c.name === "Black")!;
  const swapped = applySwaps(p, new Map([[white.id, black]]));
  expect(swapped.colors).toEqual([black]);
  expect(swapped.counts).toEqual([2]);
});

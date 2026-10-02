import { describe, expect, test } from "bun:test";
import { BRANDS, type BeadColor } from "./palettes";
import { applySwaps, DEFAULT_ADJUSTMENTS, generatePattern, sampleImage, type PatternOptions } from "./pattern";

type Px = [number, number, number, number];

const palette = BRANDS.find((b) => b.id === "perler")!.colors;
const named = (name: string) => palette.find((c) => c.name === name)!;
const white = named("White");
const black = named("Black");
const red = named("Red");
const cherry = named("Cherry");
const opaque = (c: BeadColor): Px => [...c.rgb, 255];

function image(w: number, h: number, px: (x: number, y: number) => Px): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(px(x, y), (y * w + x) * 4);
  return { width: w, height: h, data, colorSpace: "srgb" } as ImageData;
}

const opts: PatternOptions = { palette, maxColors: 24, dither: false, removeBackground: false, adjustments: DEFAULT_ADJUSTMENTS };
const gradient = image(30, 30, (x, y) => [x * 8, y * 8, (x + y) * 4, 255]);
const twoColours = () => image(2, 1, (x) => opaque(x === 0 ? white : black));

describe("generatePattern", () => {
  test("maps chart colours to themselves", () => {
    const p = generatePattern(twoColours(), opts);
    expect(p.colors.map((c) => c.id).sort()).toEqual([black.id, white.id].sort());
    expect(p.total).toBe(2);
    expect(p.width).toBe(2);
    expect(p.height).toBe(1);
  });

  test("counts add up and colours are sorted by usage", () => {
    const p = generatePattern(gradient, opts);
    expect(p.counts.reduce((a, b) => a + b, 0)).toBe(p.total);
    expect([...p.counts].sort((a, b) => b - a)).toEqual(p.counts);
    for (let i = 0; i < p.colors.length; i++) {
      expect(p.cells.filter((c) => c === i).length).toBe(p.counts[i]!);
    }
  });

  test.each([1, 2, 5, 12])("respects a limit of %i colours", (max) => {
    const p = generatePattern(gradient, { ...opts, maxColors: max });
    expect(p.colors.length).toBeLessThanOrEqual(max);
    expect(p.total).toBe(900);
  });

  test("dithering keeps every bead and the colour limit", () => {
    const p = generatePattern(gradient, { ...opts, maxColors: 6, dither: true });
    expect(p.total).toBe(900);
    expect(p.colors.length).toBeLessThanOrEqual(6);
  });

  test("dithering a mid-tone mixes colours instead of using one", () => {
    const mid = image(20, 20, () => [
      (white.rgb[0] + black.rgb[0]) / 2,
      (white.rgb[1] + black.rgb[1]) / 2,
      (white.rgb[2] + black.rgb[2]) / 2,
      255,
    ]);
    const twoBeads = [white, black];
    const flat = generatePattern(mid, { ...opts, palette: twoBeads });
    const dithered = generatePattern(mid, { ...opts, palette: twoBeads, dither: true });
    expect(flat.colors.length).toBe(1);
    expect(dithered.colors.length).toBe(2);
  });

  test("colour reduction keeps small distinct details over near-duplicates", () => {
    // 300 Red, 40 Cherry (very close to Red), 10 Black. Keeping the two most
    // used colours would lose the black; merging Cherry into Red costs less.
    const img = image(35, 10, (x, y) => {
      const i = y * 35 + x;
      return opaque(i < 300 ? red : i < 340 ? cherry : black);
    });
    const p = generatePattern(img, { ...opts, maxColors: 2 });
    expect(p.colors.map((c) => c.id).sort()).toEqual([black.id, red.id].sort());
    expect(p.counts).toEqual([340, 10]);
  });

  test("an empty palette yields no beads", () => {
    const p = generatePattern(gradient, { ...opts, palette: [] });
    expect(p.total).toBe(0);
    expect(p.colors).toEqual([]);
    expect(p.cells.every((c) => c === -1)).toBe(true);
  });

  test("brightness lightens the result", () => {
    const grey = image(4, 4, () => [110, 110, 110, 255]);
    const L = (b: number) => generatePattern(grey, { ...opts, adjustments: { ...DEFAULT_ADJUSTMENTS, brightness: b } }).colors[0]!.lab[0];
    expect(L(60)).toBeGreaterThan(L(0));
    expect(L(-60)).toBeLessThan(L(0));
  });

  test("saturation -100 turns colour into grey", () => {
    const p = generatePattern(image(2, 2, () => opaque(red)), { ...opts, adjustments: { ...DEFAULT_ADJUSTMENTS, saturation: -100 } });
    const [, a, b] = p.colors[0]!.lab;
    expect(Math.hypot(a, b)).toBeLessThan(10);
  });
});

describe("background", () => {
  test("transparent pixels are always empty", () => {
    const p = generatePattern(image(3, 3, (x, y) => (x === 1 && y === 1 ? opaque(red) : [0, 0, 0, 0])), opts);
    expect(p.total).toBe(1);
    expect(p.cells[4]).toBe(0);
  });

  test("removal clears the border-connected background", () => {
    const bg = image(5, 5, (x, y) => (x >= 1 && x <= 3 && y >= 1 && y <= 3 ? opaque(red) : [255, 255, 255, 255]));
    expect(generatePattern(bg, opts).total).toBe(25);
    expect(generatePattern(bg, { ...opts, removeBackground: true }).total).toBe(9);
  });

  test("removal keeps enclosed areas that match the background", () => {
    // White inside a red ring isn't reachable from the border.
    const ring = image(7, 7, (x, y) => {
      const edge = x >= 1 && x <= 5 && y >= 1 && y <= 5 && (x === 1 || x === 5 || y === 1 || y === 5);
      return edge ? opaque(red) : [255, 255, 255, 255];
    });
    const p = generatePattern(ring, { ...opts, removeBackground: true });
    expect(p.total).toBe(25); // 16 ring + 9 enclosed
  });
});

describe("applySwaps", () => {
  test("no swaps returns the same pattern", () => {
    const p = generatePattern(twoColours(), opts);
    expect(applySwaps(p, new Map())).toBe(p);
  });

  test("swapping into an existing colour merges counts", () => {
    const p = generatePattern(twoColours(), opts);
    const swapped = applySwaps(p, new Map([[white.id, black]]));
    expect(swapped.colors).toEqual([black]);
    expect(swapped.counts).toEqual([2]);
    expect(swapped.total).toBe(2);
  });

  test("swapping to a new colour replaces it in every cell", () => {
    const p = generatePattern(twoColours(), opts);
    const swapped = applySwaps(p, new Map([[white.id, red]]));
    expect(swapped.colors.map((c) => c.id).sort()).toEqual([black.id, red.id].sort());
    const redIdx = swapped.colors.indexOf(red);
    expect(swapped.cells[0]).toBe(redIdx);
  });

  test("keeps empty cells empty", () => {
    const p = generatePattern(image(2, 1, (x) => (x === 0 ? opaque(white) : [0, 0, 0, 0])), opts);
    const swapped = applySwaps(p, new Map([[white.id, black]]));
    expect(Array.from(swapped.cells)).toEqual([0, -1]);
  });
});

describe("sampleImage", () => {
  const fakeImage = (width: number, height: number) => ({ width, height }) as HTMLImageElement;

  test("keeps the aspect ratio", () => {
    expect([sampleImage(fakeImage(1000, 500), 52).width, sampleImage(fakeImage(1000, 500), 52).height]).toEqual([52, 26]);
    expect(sampleImage(fakeImage(300, 900), 52).height).toBe(156);
  });

  test("never produces a zero-height image", () => {
    expect(sampleImage(fakeImage(5000, 10), 52).height).toBe(1);
  });

  test("halves large images in steps before the final resize", () => {
    const drawn: number[] = [];
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: (this: HTMLCanvasElement) => unknown };
    const original = proto.getContext;
    proto.getContext = function (this: HTMLCanvasElement) {
      const ctx = original.call(this) as { drawImage: (...a: unknown[]) => void };
      const canvas = this;
      ctx.drawImage = () => drawn.push(canvas.width);
      return ctx;
    };
    try {
      sampleImage(fakeImage(1600, 1600), 50); // 1600 → 800 → 400 → 200 → 100 → 50
      expect(drawn).toEqual([800, 400, 200, 100, 50]);
    } finally {
      proto.getContext = original;
    }
  });
});

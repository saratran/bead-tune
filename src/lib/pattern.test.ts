import { describe, expect, test } from "bun:test";
import { BRANDS, type BeadColor } from "./palettes";
import { applySwaps, DEFAULT_ADJUSTMENTS, DEFAULT_PATTERN_OPTIONS, detectBackground, generatePattern, type PatternOptions } from "./pattern";

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

const opts: PatternOptions = { ...DEFAULT_PATTERN_OPTIONS, palette };
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
    const p = generatePattern(gradient, { ...opts, maxColors: 6, dither: "diffusion" });
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
    const dithered = generatePattern(mid, { ...opts, palette: twoBeads, dither: "diffusion" });
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


describe("dithering modes", () => {
  const mid = image(16, 16, () => [128, 128, 128, 255]);
  const bw = { ...opts, palette: [white, black] };

  test("ordered dithering mixes colours in a repeating 8×8 pattern", () => {
    const p = generatePattern(mid, { ...bw, dither: "ordered", ditherStrength: 100 });
    expect(p.colors.length).toBe(2);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        expect(p.cells[y * 16 + x]).toBe(p.cells[y * 16 + x + 8]!);
        expect(p.cells[y * 16 + x]).toBe(p.cells[(y + 8) * 16 + x]!);
      }
    }
  });

  test("strength 0 is the same as no dithering", () => {
    const none = generatePattern(gradient, { ...opts, maxColors: 6 });
    for (const dither of ["diffusion", "ordered"] as const) {
      const off = generatePattern(gradient, { ...opts, maxColors: 6, dither, ditherStrength: 0 });
      expect(Array.from(off.cells)).toEqual(Array.from(none.cells));
    }
  });

  test("weaker ordered dithering mixes fewer pixels", () => {
    // A grey just on the white side of the black/white midpoint.
    const grey = image(16, 16, () => [150, 150, 150, 255]);
    const blackCount = (strength: number) => {
      const p = generatePattern(grey, { ...bw, dither: "ordered", ditherStrength: strength });
      const i = p.colors.indexOf(black);
      return i < 0 ? 0 : p.counts[i]!;
    };
    expect(blackCount(30)).toBe(0);
    expect(blackCount(100)).toBeGreaterThan(0);
    expect(blackCount(100)).toBeLessThan(256 / 2);
  });
});

test("accurate matching maps chart colours to themselves too", () => {
  const p = generatePattern(twoColours(), { ...opts, metric: "accurate" });
  expect(p.colors.map((c) => c.id).sort()).toEqual([black.id, white.id].sort());
  const g = generatePattern(gradient, { ...opts, metric: "accurate", maxColors: 8 });
  expect(g.colors.length).toBeLessThanOrEqual(8);
  expect(g.total).toBe(900);
});

describe("min beads per colour", () => {
  // 300 red, 10 black, 5 white.
  const img = image(35, 9, (x, y) => {
    const i = y * 35 + x;
    return opaque(i < 300 ? red : i < 310 ? black : white);
  });

  test("merges colours used by too few beads", () => {
    expect(generatePattern(img, opts).colors.length).toBe(3);
    const p = generatePattern(img, { ...opts, minBeads: 8 });
    expect(p.colors.map((c) => c.id).sort()).toEqual([black.id, red.id].sort());
    expect(p.total).toBe(315);
  });

  test("0 and 1 mean off", () => {
    expect(generatePattern(img, { ...opts, minBeads: 1 }).colors.length).toBe(3);
  });

  test("always keeps at least one colour", () => {
    const p = generatePattern(img, { ...opts, minBeads: 10_000 });
    expect(p.colors).toEqual([red]);
    expect(p.total).toBe(315);
  });
});

describe("background options", () => {
  // Outer ring white, second ring light grey, red centre.
  const rings = image(5, 5, (x, y) => {
    const d = Math.min(x, y, 4 - x, 4 - y);
    return d === 0 ? [255, 255, 255, 255] : d === 1 ? [238, 238, 238, 255] : opaque(red);
  });

  test("tolerance controls how far from the background colour still counts", () => {
    expect(generatePattern(rings, { ...opts, removeBackground: true, bgTolerance: 2 }).total).toBe(9);
    expect(generatePattern(rings, { ...opts, removeBackground: true, bgTolerance: 14 }).total).toBe(1);
  });

  test("a picked background colour replaces the detected one", () => {
    // Left column green, rest white, red centre.
    const img = image(5, 5, (x, y) => (x === 0 ? [40, 160, 60, 255] : x === 2 && y === 2 ? opaque(red) : [255, 255, 255, 255]));
    expect(generatePattern(img, { ...opts, removeBackground: true }).total).toBe(6);
    expect(generatePattern(img, { ...opts, removeBackground: true, bgColor: [40, 160, 60] }).total).toBe(20);
  });

  test("detectBackground finds the main border colour", () => {
    expect(detectBackground(rings)).toEqual([255, 255, 255]);
    expect(detectBackground(image(3, 3, () => [0, 0, 0, 0]))).toBeNull();
  });

  test("detectBackground applies the same adjustments as matching", () => {
    const [r] = detectBackground(image(3, 3, () => [100, 100, 100, 255]), { ...DEFAULT_ADJUSTMENTS, brightness: 40 })!;
    expect(r).toBeGreaterThan(100);
  });
});

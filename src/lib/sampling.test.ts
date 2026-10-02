import { describe, expect, test } from "bun:test";
import {
  blockAverage,
  blockMode,
  canvasSource,
  detectPixelGrid,
  FULL_CROP,
  imageDataSource,
  makeImageData,
  medianFilter,
  pixelArtGrid,
  sampleGrid,
} from "./sampling";

type Px = [number, number, number, number];

function image(w: number, h: number, px: (x: number, y: number) => Px): ImageData {
  const out = makeImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.data.set(px(x, y), (y * w + x) * 4);
  return out;
}

const pixel = (img: ImageData, x: number, y: number) => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

const RED: Px = [200, 30, 40, 255];
const PINK: Px = [230, 150, 160, 255];
const WHITE: Px = [255, 255, 255, 255];
const CLEAR: Px = [0, 0, 0, 0];

describe("blockAverage / blockMode", () => {
  // One 4×4 block: 12 red pixels and a column of 4 anti-aliased pink ones.
  const fringe = image(4, 4, (x) => (x === 3 ? PINK : RED));

  test("smooth averages, blending in the fringe", () => {
    const out = blockAverage(fringe, 4);
    expect([out.width, out.height]).toEqual([1, 1]);
    expect(pixel(out, 0, 0)).toEqual([208, 60, 70, 255]);
  });

  test("sharp keeps the dominant colour", () => {
    expect(pixel(blockMode(fringe, 4), 0, 0)).toEqual(RED);
  });

  test("k = 1 is a no-op", () => {
    expect(blockAverage(fringe, 1)).toBe(fringe);
    expect(blockMode(fringe, 1)).toBe(fringe);
  });

  test("averaging ignores transparent pixels for colour; alpha is the opaque share", () => {
    const half = image(2, 2, (x) => (x === 0 ? RED : CLEAR));
    expect(pixel(blockAverage(half, 2), 0, 0)).toEqual([200, 30, 40, 128]);
  });

  test("sharp makes mostly-transparent blocks empty", () => {
    const mostlyClear = image(2, 2, (x, y) => (x === 0 && y === 0 ? RED : CLEAR));
    expect(pixel(blockMode(mostlyClear, 2), 0, 0)).toEqual([0, 0, 0, 0]);
  });

  test("sharp groups slightly noisy pixels together", () => {
    // 3 near-identical reds outvote 1 white even though no two reds are equal.
    const noisy = image(2, 2, (x, y) => (x === 1 && y === 1 ? WHITE : [200 + x, 30 + y, 40, 255]));
    const [r, g, b] = pixel(blockMode(noisy, 2), 0, 0);
    expect(r).toBeGreaterThanOrEqual(200);
    expect(r).toBeLessThanOrEqual(201);
    expect(g).toBeGreaterThanOrEqual(30);
    expect(b).toBe(40);
  });
});

describe("medianFilter", () => {
  test("removes a single speck", () => {
    const speck = image(5, 5, (x, y) => (x === 2 && y === 2 ? WHITE : RED));
    expect(pixel(medianFilter(speck), 2, 2)).toEqual(RED);
  });

  test("keeps straight edges", () => {
    const split = image(6, 4, (x) => (x < 3 ? RED : WHITE));
    const out = medianFilter(split);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) expect(pixel(out, x, y)).toEqual(x < 3 ? RED : WHITE);
  });

  test("keeps alpha", () => {
    const out = medianFilter(image(3, 3, (x) => (x === 0 ? CLEAR : RED)));
    expect(pixel(out, 0, 1)[3]).toBe(0);
  });
});

describe("pixel art", () => {
  // 6 × 5 art where neighbouring cells always differ, so every run is exactly one art pixel.
  const palette: Px[] = [
    [230, 40, 50, 255],
    [40, 120, 230, 255],
    [250, 220, 60, 255],
    [30, 30, 30, 255],
  ];
  const art = (c: number, r: number) => palette[(c + 2 * r) % 4]!;

  function enlarge(scale: number, offset: number, noise = 0) {
    const w = offset + 6 * scale;
    const h = offset + 5 * scale;
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * noise;
    return image(w, h, (x, y) => {
      if (x < offset || y < offset) return [120, 200, 120, 255]; // partial cells at the edge
      const [r, g, b] = art(Math.floor((x - offset) / scale), Math.floor((y - offset) / scale));
      return [r + rand(), g + rand(), b + rand(), 255];
    });
  }

  test("detects the scale", () => {
    expect(detectPixelGrid(enlarge(6, 0))).toMatchObject({ scale: 6, offsetX: 0, offsetY: 0, cols: 6, rows: 5 });
    expect(detectPixelGrid(enlarge(3, 0)).scale).toBe(3);
  });

  test("detects an offset grid", () => {
    expect(detectPixelGrid(enlarge(6, 2))).toMatchObject({ scale: 6, offsetX: 2, offsetY: 2, cols: 6, rows: 5 });
  });

  test("tolerates compression noise", () => {
    expect(detectPixelGrid(enlarge(5, 0, 6)).scale).toBe(5);
  });

  test("finds no grid in a noisy photo-like image", () => {
    let seed = 1;
    const rnd = () => (seed = (seed * 16807) % 2147483647) % 256;
    expect(detectPixelGrid(image(60, 60, () => [rnd(), rnd(), rnd(), 255])).scale).toBe(1);
  });

  test("finds no grid in a smooth gradient", () => {
    expect(detectPixelGrid(image(60, 60, (x, y) => [x * 4, y * 4, 128, 255])).scale).toBe(1);
  });

  test("pixelArtGrid recovers the original art", () => {
    const src = enlarge(6, 2, 4);
    const out = pixelArtGrid(src, detectPixelGrid(src));
    expect([out.width, out.height]).toEqual([6, 5]);
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 6; c++) {
        const got = pixel(out, c, r);
        const want = art(c, r);
        for (let i = 0; i < 3; i++) expect(Math.abs(got[i]! - want[i]!)).toBeLessThanOrEqual(4);
      }
    }
  });
});

describe("sampleGrid", () => {
  const big = imageDataSource(image(400, 200, (x) => (x < 200 ? RED : WHITE)));

  test("keeps the aspect ratio", () => {
    const out = sampleGrid(big, 50, FULL_CROP, "smooth", false);
    expect([out.width, out.height]).toEqual([50, 25]);
  });

  test("crop changes the aspect ratio and content", () => {
    const right = sampleGrid(big, 50, { x: 0.5, y: 0, w: 0.5, h: 1 }, "sharp", false);
    expect([right.width, right.height]).toEqual([50, 50]);
    expect(pixel(right, 0, 0)).toEqual(WHITE);
  });

  test("works when the source is smaller than the grid", () => {
    const small = imageDataSource(image(10, 10, () => RED));
    const out = sampleGrid(small, 20, FULL_CROP, "sharp", true);
    expect([out.width, out.height]).toEqual([20, 20]);
    expect(pixel(out, 5, 5)).toEqual(RED);
  });

  test("sharp avoids blended colours at an edge that splits beads", () => {
    // Edge at x = 202 lands inside a bead (beads are 8px wide here).
    const src = imageDataSource(image(400, 40, (x) => (x < 202 ? RED : WHITE)));
    const colours = (mode: "smooth" | "sharp") => {
      const out = sampleGrid(src, 50, FULL_CROP, mode, false);
      return new Set(Array.from({ length: out.width }, (_, x) => pixel(out, x, 0).join()));
    };
    expect(colours("sharp").size).toBe(2);
    expect(colours("smooth").size).toBe(3);
  });
});

describe("imageDataSource", () => {
  test("scaled averages areas of the crop", () => {
    const src = imageDataSource(image(4, 2, (x) => (x < 2 ? [0, 0, 0, 255] : [200, 100, 50, 255])));
    const out = src.scaled(2, 1, FULL_CROP);
    expect(pixel(out, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(pixel(out, 1, 0)).toEqual([200, 100, 50, 255]);
    expect(pixel(src.scaled(1, 1, { x: 0.5, y: 0, w: 0.5, h: 1 }), 0, 0)).toEqual([200, 100, 50, 255]);
  });
});

describe("canvasSource", () => {
  const fakeImage = (width: number, height: number) => ({ width, height }) as HTMLImageElement;

  type Draw = { width: number; args: unknown[]; smoothing: boolean };
  function recordDraws(fn: () => void): Draw[] {
    const draws: Draw[] = [];
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: (this: HTMLCanvasElement) => unknown };
    const original = proto.getContext;
    proto.getContext = function (this: HTMLCanvasElement) {
      const ctx = original.call(this) as { drawImage: (...a: unknown[]) => void; imageSmoothingEnabled: boolean };
      const canvas = this;
      ctx.drawImage = (...args: unknown[]) => draws.push({ width: canvas.width, args, smoothing: ctx.imageSmoothingEnabled });
      return ctx;
    };
    try {
      fn();
    } finally {
      proto.getContext = original;
    }
    return draws;
  }

  test("halves large images in steps before the final resize", () => {
    const draws = recordDraws(() => canvasSource(fakeImage(1600, 1600)).scaled(50, 50, FULL_CROP));
    expect(draws.map((d) => d.width)).toEqual([800, 400, 200, 100, 50]);
  });

  test("crops from the source rectangle", () => {
    const draws = recordDraws(() => canvasSource(fakeImage(1000, 500)).scaled(100, 50, { x: 0.25, y: 0.5, w: 0.5, h: 0.5 }));
    expect(draws[0]!.args.slice(1, 5)).toEqual([250, 250, 500, 250]);
  });

  test("caches repeated requests", () => {
    const src = canvasSource(fakeImage(400, 400));
    expect(src.scaled(40, 40, FULL_CROP)).toBe(src.scaled(40, 40, FULL_CROP));
    expect(src.scaled(40, 40, FULL_CROP)).not.toBe(src.scaled(20, 20, FULL_CROP));
  });

  test("native keeps hard pixel edges", () => {
    const draws = recordDraws(() => canvasSource(fakeImage(64, 32)).native());
    expect(draws.map((d) => [d.width, d.smoothing])).toEqual([[64, false]]);
  });

  test("native caps huge images at 4096px", () => {
    const native = canvasSource(fakeImage(5000, 100)).native();
    expect([native.width, native.height]).toEqual([4096, 82]);
  });
});

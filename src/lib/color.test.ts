import { describe, expect, test } from "bun:test";
import { colorDistance, contrastText, deltaE2000, hexToRgb, labDistSq, rgbToHex, rgbToLab, shade, type Lab } from "./color";

describe("hexToRgb / rgbToHex", () => {
  test("parses 6-digit hex with or without #", () => {
    expect(hexToRgb("#FF8000")).toEqual([255, 128, 0]);
    expect(hexToRgb("00ff00")).toEqual([0, 255, 0]);
  });

  test("expands 3-digit hex", () => {
    expect(hexToRgb("#f80")).toEqual([255, 136, 0]);
  });

  test("formats lowercase, zero-padded and rounded", () => {
    expect(rgbToHex([255, 128, 0])).toBe("#ff8000");
    expect(rgbToHex([1, 2, 3])).toBe("#010203");
    expect(rgbToHex([127.6, 0.4, 254.5])).toBe("#8000ff");
  });

  test("round-trips", () => {
    for (const hex of ["#000000", "#ffffff", "#3a7bd5", "#e0393e"]) {
      expect(rgbToHex(hexToRgb(hex))).toBe(hex);
    }
  });
});

describe("rgbToLab", () => {
  const close = (a: number[], b: number[], tol: number) => a.forEach((v, i) => expect(Math.abs(v - b[i]!)).toBeLessThan(tol));

  test("white and black hit the ends of the lightness axis", () => {
    close(rgbToLab(255, 255, 255), [100, 0, 0], 0.01);
    close(rgbToLab(0, 0, 0), [0, 0, 0], 0.01);
  });

  test("matches reference values for sRGB primaries (D65)", () => {
    close(rgbToLab(255, 0, 0), [53.24, 80.09, 67.2], 0.05);
    close(rgbToLab(0, 0, 255), [32.3, 79.19, -107.86], 0.05);
  });

  test("greys are neutral", () => {
    const [, a, b] = rgbToLab(128, 128, 128);
    expect(Math.abs(a)).toBeLessThan(0.01);
    expect(Math.abs(b)).toBeLessThan(0.01);
  });
});

test("labDistSq is the squared euclidean distance", () => {
  expect(labDistSq([0, 0, 0], [3, 4, 0])).toBe(25);
  expect(labDistSq([10, -5, 2], [10, -5, 2])).toBe(0);
});

test("contrastText picks dark ink on light colours and white on dark", () => {
  expect(contrastText([255, 255, 255])).toBe("#1d1b26");
  expect(contrastText([250, 230, 120])).toBe("#1d1b26");
  expect(contrastText([0, 0, 0])).toBe("#ffffff");
  expect(contrastText([40, 60, 140])).toBe("#ffffff");
});

test("shade darkens towards black", () => {
  expect(shade([200, 100, 50], 0.5)).toBe("#643219");
  expect(shade([200, 100, 50], 0)).toBe("#c86432");
  expect(shade([200, 100, 50], 1)).toBe("#000000");
});

describe("deltaE2000", () => {
  // Reference pairs from Sharma, Wu & Dalal (2005), table 1.
  test.each([
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ] as [Lab, Lab, number][])("%p vs %p = %d", (a, b, expected) => {
    expect(deltaE2000(a, b)).toBeCloseTo(expected, 4);
  });

  test("is zero for identical colours and symmetric", () => {
    expect(deltaE2000([40, 20, -30], [40, 20, -30])).toBe(0);
    expect(deltaE2000([40, 20, -30], [60, -10, 5])).toBeCloseTo(deltaE2000([60, -10, 5], [40, 20, -30]), 10);
  });
});

test("colorDistance picks the metric", () => {
  expect(colorDistance("standard")([0, 0, 0], [3, 4, 0])).toBe(5);
  expect(colorDistance("accurate")([50, 0, 0], [50, -1, 2])).toBeCloseTo(2.3669, 4);
});

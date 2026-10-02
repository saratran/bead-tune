import { describe, expect, test } from "bun:test";
import { centredCrop, clampCrop, composeCrop, cropImageData, cropPixels, dragCrop, FULL_CROP, isFullCrop, MIN_CROP } from "./crop";
import { makeImageData, type Crop } from "./sampling";

const close = (a: Crop, b: Crop) => {
  for (const k of ["x", "y", "w", "h"] as const) expect(a[k]).toBeCloseTo(b[k], 6);
};

test("isFullCrop", () => {
  expect(isFullCrop(FULL_CROP)).toBe(true);
  expect(isFullCrop({ x: 0, y: 0, w: 0.99, h: 1 })).toBe(false);
});

test("clampCrop keeps the crop inside the image and above the minimum size", () => {
  close(clampCrop({ x: -0.2, y: 0.9, w: 0.5, h: 0.5 }), { x: 0, y: 0.5, w: 0.5, h: 0.5 });
  close(clampCrop({ x: 0.5, y: 0.5, w: 0, h: 2 }), { x: 0.5, y: 0, w: MIN_CROP, h: 1 });
});

test("composeCrop nests a crop inside another", () => {
  close(composeCrop({ x: 0.5, y: 0.2, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 1 }), { x: 0.75, y: 0.2, w: 0.25, h: 0.5 });
  close(composeCrop(FULL_CROP, { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }), { x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
});

describe("dragCrop", () => {
  const start = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };

  test("move shifts without resizing and stops at the edges", () => {
    close(dragCrop(start, "move", 0.1, -0.05), { x: 0.35, y: 0.2, w: 0.5, h: 0.5 });
    close(dragCrop(start, "move", 1, 1), { x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
  });

  test("edges and corners resize from the opposite side", () => {
    close(dragCrop(start, "e", 0.1, 0.3), { x: 0.25, y: 0.25, w: 0.6, h: 0.5 });
    close(dragCrop(start, "w", -0.1, 0), { x: 0.15, y: 0.25, w: 0.6, h: 0.5 });
    close(dragCrop(start, "n", 0, 0.1), { x: 0.25, y: 0.35, w: 0.5, h: 0.4 });
    close(dragCrop(start, "se", 0.1, 0.2), { x: 0.25, y: 0.25, w: 0.6, h: 0.7 });
    close(dragCrop(start, "nw", -0.5, -0.5), { x: 0, y: 0, w: 0.75, h: 0.75 });
  });

  test("can't shrink below the minimum or flip over", () => {
    const c = dragCrop(start, "e", -2, 0);
    expect(c.w).toBeCloseTo(MIN_CROP);
    expect(c.x).toBeCloseTo(0.25);
  });

  test("square keeps equal pixel sides on a wide image", () => {
    // Image twice as wide as tall: a pixel-square crop is half as wide (in fractions) as it is tall.
    const c = dragCrop({ x: 0, y: 0, w: 0.25, h: 0.5 }, "se", 0.25, 0, 1, 2);
    expect(c.w * 2).toBeCloseTo(c.h); // 2:1 image → w fraction = h fraction / 2
    expect(c.x).toBeCloseTo(0);
    expect(c.y).toBeCloseTo(0);
  });

  test("square from a top/bottom edge sizes from the height", () => {
    const c = dragCrop({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, "s", 0, 0.1, 1, 1);
    expect(c.w).toBeCloseTo(c.h);
    expect(c.h).toBeCloseTo(0.6);
  });

  test("square never leaves the image", () => {
    const c = dragCrop({ x: 0.5, y: 0.5, w: 0.25, h: 0.25 }, "se", 2, 2, 1, 1);
    expect(c.x + c.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(c.y + c.h).toBeLessThanOrEqual(1 + 1e-9);
    expect(c.w).toBeCloseTo(c.h);
  });
});

test("centredCrop is the largest centred crop with that aspect", () => {
  close(centredCrop(1, 2), { x: 0.25, y: 0, w: 0.5, h: 1 }); // square on a 2:1 image
  close(centredCrop(1, 0.5), { x: 0, y: 0.25, w: 1, h: 0.5 }); // square on a 1:2 image
});

test("cropPixels rounds to whole pixels and never collapses", () => {
  expect(cropPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 }, 200, 100)).toEqual({ x: 50, y: 50, w: 100, h: 50 });
  expect(cropPixels({ x: 0, y: 0, w: 0.001, h: 0.001 }, 10, 10)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
});

test("cropImageData copies the cropped pixels", () => {
  const src = makeImageData(4, 2);
  for (let i = 0; i < 8; i++) src.data[i * 4] = i; // red channel = pixel index
  const out = cropImageData(src, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
  expect([out.width, out.height]).toEqual([2, 1]);
  expect([out.data[0], out.data[4]]).toEqual([6, 7]);
  expect(cropImageData(src, FULL_CROP)).toBe(src);
});

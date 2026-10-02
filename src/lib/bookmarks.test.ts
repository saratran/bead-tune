import { describe, expect, test } from "bun:test";
import type { Candidate } from "./auto";
import { imageFingerprint, loadBookmarks, MAX_PER_IMAGE, mergeBookmarks, saveBookmarks, sameCandidate, type Bookmark } from "./bookmarks";
import { imageDataSource, makeImageData } from "./sampling";

const cand = (maxColors: number): Candidate => ({ sampling: "smooth", denoise: false, maxColors, dither: { mode: "none", strength: 0 }, cleanup: 0, metric: "standard", minBeads: 0, brightness: 0, contrast: 0, saturation: 0 });
const bm = (maxColors: number, createdAt = maxColors): Bookmark => ({ id: `b${maxColors}`, label: "X", candidate: cand(maxColors), thumbnail: "data:image/png;base64,AA==", likeness: 80, ease: 50, colors: maxColors, beads: 100, strays: 3, createdAt, context: { width: 52, brandId: "mard" } });

function source(seed: number) {
  const img = makeImageData(40, 30);
  for (let i = 0; i < 40 * 30; i++) img.data.set([(i * seed) % 256, (i * 3) % 256, 100, 255], i * 4);
  return imageDataSource(img);
}

describe("imageFingerprint", () => {
  test("is stable for the same image and differs for different ones", () => {
    expect(imageFingerprint(source(7))).toBe(imageFingerprint(source(7)));
    expect(imageFingerprint(source(7))).not.toBe(imageFingerprint(source(11)));
  });

  test("ignores tiny re-encoding differences", () => {
    const a = makeImageData(40, 30), b = makeImageData(40, 30);
    for (let i = 0; i < 40 * 30; i++) {
      a.data.set([120, 80, 40, 255], i * 4);
      b.data.set([121, 81, 40, 255], i * 4);
    }
    expect(imageFingerprint(imageDataSource(a))).toBe(imageFingerprint(imageDataSource(b)));
  });
});

describe("storage", () => {
  test("bookmarks are kept per image", () => {
    saveBookmarks("img-a", [bm(12)]);
    saveBookmarks("img-b", [bm(24), bm(40)]);
    expect(loadBookmarks("img-a").map((b) => b.colors)).toEqual([12]);
    expect(loadBookmarks("img-b")).toHaveLength(2);
    expect(loadBookmarks("img-c")).toEqual([]);
    saveBookmarks("img-a", []);
    expect(loadBookmarks("img-a")).toEqual([]);
  });

  test("keeps the newest MAX_PER_IMAGE", () => {
    saveBookmarks("many", Array.from({ length: MAX_PER_IMAGE + 5 }, (_, i) => bm(i + 2, i)));
    const kept = loadBookmarks("many");
    expect(kept).toHaveLength(MAX_PER_IMAGE);
    expect(kept[0]!.createdAt).toBe(5);
  });

  test("merge skips bookmarks with the same settings", () => {
    const merged = mergeBookmarks([bm(12), bm(24)], [bm(24, 99), bm(40)]);
    expect(merged.map((b) => b.colors)).toEqual([12, 24, 40]);
    expect(sameCandidate(cand(12), cand(12))).toBe(true);
    expect(sameCandidate(cand(12), cand(13))).toBe(false);
  });
});

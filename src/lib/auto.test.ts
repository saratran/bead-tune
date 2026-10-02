import { describe, expect, test } from "bun:test";
import { makePattern, mard } from "../test/fixtures";
import { padPattern } from "./cleanup";
import {
  candidateSettings,
  countCombinations,
  DEFAULT_SEARCH_SPACE,
  difference,
  enumerateCandidates,
  rate,
  scan,
  scorePattern,
  suggest,
  type Candidate,
  type Metrics,
  type SearchSpace,
} from "./auto";
import { DEFAULT_PATTERN_OPTIONS, type Pattern } from "./pattern";
import type { PipelineSettings } from "./pipeline";
import { FULL_CROP, imageDataSource, makeImageData } from "./sampling";

const tiny: SearchSpace = {
  ...DEFAULT_SEARCH_SPACE,
  sampling: ["smooth", "sharp"],
  maxColors: [4, 8, 16],
  dither: [{ mode: "none", strength: 0 }],
  cleanup: [0],
  contrast: [0],
  saturation: [0],
};

describe("search space", () => {
  test("counts combinations", () => {
    expect(countCombinations(tiny)).toBe(6);
    expect(countCombinations(DEFAULT_SEARCH_SPACE)).toBe(2 * 1 * 4 * 2 * 2 * 1 * 1 * 1 * 2 * 2);
  });

  test("enumerates every combination when under the limit", () => {
    const all = enumerateCandidates(tiny);
    expect(all).toHaveLength(6);
    expect(new Set(all.map((c) => JSON.stringify(c))).size).toBe(6);
  });

  test("an evenly spread subset still covers every value", () => {
    const space: SearchSpace = { ...DEFAULT_SEARCH_SPACE, maxColors: [8, 16, 24, 32, 48, 64], brightness: [-10, 0, 10] };
    const subset = enumerateCandidates(space, 40);
    expect(subset).toHaveLength(40);
    expect(new Set(subset.map((c) => JSON.stringify(c))).size).toBe(40);
    for (const v of space.maxColors) expect(subset.some((c) => c.maxColors === v)).toBe(true);
    for (const v of space.brightness) expect(subset.some((c) => c.brightness === v)).toBe(true);
  });

  test("candidateSettings applies a candidate on top of the current settings", () => {
    const base: PipelineSettings = { width: 30, sampling: "smooth", denoise: false, trim: true, cleanup: 0, outline: null, options: { ...DEFAULT_PATTERN_OPTIONS, palette: mard, removeBackground: true } };
    const c: Candidate = { sampling: "sharp", denoise: true, maxColors: 40, dither: { mode: "ordered", strength: 70 }, cleanup: 2, metric: "accurate", minBeads: 3, brightness: 10, contrast: 15, saturation: 20 };
    const s = candidateSettings(base, c);
    expect(s).toMatchObject({ width: 30, trim: true, sampling: "sharp", denoise: true, cleanup: 2 });
    expect(s.options).toMatchObject({ removeBackground: true, maxColors: 40, minBeads: 3, metric: "accurate", dither: "ordered", ditherStrength: 70 });
    expect(s.options.adjustments).toEqual({ brightness: 10, contrast: 15, saturation: 20 });
  });
});

/** Reference image whose pixels are exactly the pattern's bead colours. */
function referenceOf(p: Pattern): ImageData {
  const img = makeImageData(p.width, p.height);
  for (let i = 0; i < p.cells.length; i++) {
    const idx = p.cells[i]!;
    if (idx >= 0) img.data.set([...p.colors[idx]!.rgb, 255], i * 4);
  }
  return img;
}

describe("scorePattern", () => {
  const flat = makePattern(Array.from({ length: 8 }, () => "aaaabbbb"));

  test("a pattern matching the original scores perfectly on likeness", () => {
    const m = scorePattern(flat, referenceOf(flat));
    expect(m.colorError).toBeCloseTo(0, 5);
    expect(m.detailError).toBeCloseTo(0, 5);
    expect(m.distanceError).toBeCloseTo(0, 5);
    expect(m.noise).toBeCloseTo(0, 5);
    expect(m.edgeError).toBeCloseTo(0, 5);
  });

  test("speckle the original doesn't have counts as noise and strays", () => {
    const speckled = makePattern(Array.from({ length: 8 }, (_, y) => (y % 2 ? "abaabbab" : "aabababb")));
    const m = scorePattern(speckled, referenceOf(flat));
    expect(m.noise).toBeGreaterThan(1);
    expect(m.strays).toBeGreaterThan(0);
    expect(m.fragmentation).toBeGreaterThan(scorePattern(flat, referenceOf(flat)).fragmentation);
  });

  test("counts colours, beads and fragmentation", () => {
    const m = scorePattern(flat, referenceOf(flat));
    expect(m).toMatchObject({ colors: 2, beads: 64, strays: 0 });
    expect(m.fragmentation).toBeCloseTo((2 / 64) * 100);
  });

  test("losing a small detail shows up in detailError more than in the mean", () => {
    const withEye = makePattern(["aaaaaaaa", "aaaaaaaa", "aaaaaaaa", "aaacaaaa", "aaaaaaaa", "aaaaaaaa", "aaaaaaaa", "aaaaaaaa"]);
    const noEye = { ...withEye, cells: withEye.cells.map((c) => (c === 1 ? 0 : c)) as unknown as Int16Array };
    const m = scorePattern(noEye as Pattern, referenceOf(withEye));
    expect(m.detailError).toBeGreaterThan(m.colorError * 3);
  });

  test("offsets line the reference up with trimmed/outlined patterns", () => {
    const padded = padPattern(flat, 1); // like an outline's extra ring
    expect(scorePattern(padded, referenceOf(flat), 1, 1).colorError).toBeCloseTo(0, 5);
    expect(scorePattern(padded, referenceOf(flat), 0, 0).colorError).toBeGreaterThan(0.1);
  });
});

describe("rate and suggest", () => {
  const m = (over: Partial<Metrics>): Metrics => ({ colorError: 5, detailError: 5, distanceError: 5, edgeError: 0.1, noise: 1, colors: 20, beads: 100, strays: 10, fragmentation: 10, ...over });
  const cand = (over: Partial<Candidate>): Candidate => ({ ...enumerateCandidates(tiny)[0]!, ...over });
  // Distinct patterns so suggestions aren't treated as duplicates.
  const pat = (seed: number) => makePattern(Array.from({ length: 4 }, (_, y) => Array.from({ length: 4 }, (_, x) => ((x + y + seed) % 3 === 0 ? "a" : "b")).join("")));

  test("likeness and ease are 0–100 within the scan", () => {
    const rated = rate([
      { candidate: cand({ maxColors: 8 }), pattern: pat(0), metrics: m({ colorError: 2, colors: 40 }) },
      { candidate: cand({ maxColors: 16 }), pattern: pat(1), metrics: m({ colorError: 9, colors: 8 }) },
    ]);
    expect(rated[0]!.likeness).toBeGreaterThan(rated[1]!.likeness);
    expect(rated[1]!.ease).toBeGreaterThan(rated[0]!.ease);
    for (const r of rated) {
      expect(r.likeness).toBeGreaterThanOrEqual(0);
      expect(r.likeness).toBeLessThanOrEqual(100);
    }
  });

  test("with the same look, fewer colours wins", () => {
    const rated = rate([
      { candidate: cand({ maxColors: 64 }), pattern: pat(0), metrics: m({ colors: 64 }) },
      { candidate: cand({ maxColors: 16 }), pattern: pat(1), metrics: m({ colors: 16 }) },
    ]);
    expect(suggest(rated, 1)[0]!.candidate.maxColors).toBe(16);
  });

  test("named picks first, near-duplicates dropped, count respected", () => {
    const same = pat(0);
    const rated = rate([
      { candidate: cand({ maxColors: 4 }), pattern: same, metrics: m({ colorError: 9, colors: 4, strays: 0 }) },
      { candidate: cand({ maxColors: 8 }), pattern: same, metrics: m({ colorError: 6, colors: 8 }) },
      { candidate: cand({ maxColors: 16 }), pattern: pat(1), metrics: m({ colorError: 2, colors: 16 }) },
      { candidate: cand({ maxColors: 4, sampling: "sharp" }), pattern: pat(2), metrics: m({ colorError: 7, colors: 5 }) },
    ]);
    const s = suggest(rated, 6);
    expect(s[0]!.label).toBe("Most faithful");
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) expect(difference(s[i]!.pattern, s[j]!.pattern)).toBeGreaterThan(0);
    expect(suggest(rated, 2)).toHaveLength(2);
  });

  test("difference counts differing beads", () => {
    expect(difference(pat(0), pat(0))).toBe(0);
    expect(difference(pat(0), makePattern(["a"]))).toBe(1);
  });
});

describe("scan", () => {
  // Red disc on a blue gradient.
  const img = makeImageData(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const disc = (x - 32) ** 2 + (y - 32) ** 2 < 15 ** 2;
    img.data.set(disc ? [210, 40, 50, 255] : [30, 60 + y, 120 + x, 255], (y * 64 + x) * 4);
  }
  const source = imageDataSource(img);
  const base: PipelineSettings = { width: 16, sampling: "smooth", denoise: false, trim: false, cleanup: 0, outline: null, crop: FULL_CROP, options: { ...DEFAULT_PATTERN_OPTIONS, palette: mard } };

  test("scores every candidate and reports progress", async () => {
    const progress: number[] = [];
    const results = await scan(source, base, enumerateCandidates(tiny), (p) => progress.push(p.done), undefined, 0);
    expect(results).toHaveLength(6);
    expect(progress.at(-1)).toBe(6);
    expect(results.every((r) => r.metrics.colors <= r.candidate.maxColors)).toBe(true);
    const s = suggest(rate(results), 4);
    expect(s.length).toBeGreaterThan(0);
    expect(s[0]!.label).toBe("Most faithful");
  });

  test("stops when cancelled", async () => {
    const ctrl = new AbortController();
    const results = await scan(source, base, enumerateCandidates(tiny), (p) => p.done >= 2 && ctrl.abort(), ctrl.signal, 0);
    expect(results.length).toBeLessThan(6);
  });
});

import { describe, expect, test } from "bun:test";
import { makePattern, mard } from "../test/fixtures";
import { padPattern } from "./cleanup";
import { rgbToLab as rgbLab } from "./color";
import {
  autoSuggest,
  candidateSettings,
  colorCost,
  effortCost,
  featureCost,
  likenessCost,
  makeEvaluator,
  neighbours,
  objectiveFor,
  refine,
  spaceForTone,
  TONE_CHROMA,
  tuneFromPreferences,
  pickName,
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
  const m = (over: Partial<Metrics>): Metrics => ({ colorError: 5, detailError: 5, distanceError: 5, edgeError: 0.1, featureLoss: 0.2, noise: 1, toneError: 0.05, colors: 20, beads: 100, strays: 10, fragmentation: 10, ...over });
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

describe("refinement", () => {
  // Soft gradient with a small dark detail: in-between settings matter here.
  const img = makeImageData(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const eye = (x - 40) ** 2 + (y - 24) ** 2 < 4 ** 2;
    img.data.set(eye ? [20, 20, 30, 255] : [120 + x, 90 + y, 150 - x / 2, 255], (y * 64 + x) * 4);
  }
  const source = imageDataSource(img);
  const base: PipelineSettings = { width: 16, sampling: "smooth", denoise: false, trim: false, cleanup: 0, outline: null, crop: FULL_CROP, options: { ...DEFAULT_PATTERN_OPTIONS, palette: mard } };
  const start: Candidate = { sampling: "smooth", denoise: false, maxColors: 6, dither: { mode: "none", strength: 0 }, cleanup: 0, metric: "standard", minBeads: 0, brightness: 20, contrast: 0, saturation: 0 };

  test.each(["pattern", "anneal"] as const)("%s improves the objective within the budget", async (method) => {
    const evaluate = makeEvaluator(source, base);
    const first = evaluate(start)!;
    const objective = objectiveFor("Most faithful");
    const { best, tried } = await refine(evaluate, first, objective, { method, budget: 30, seed: 3 });
    expect(tried.length).toBeGreaterThan(0);
    expect(tried.length).toBeLessThanOrEqual(30);
    expect(objective(best.metrics)).toBeLessThanOrEqual(objective(first.metrics));
    // From a deliberately poor start (too bright, too few colours), pattern search must find better.
    if (method === "pattern") expect(objective(best.metrics)).toBeLessThan(objective(first.metrics));
  });

  test("keeps the categorical choices fixed", async () => {
    const evaluate = makeEvaluator(source, base);
    const sharp = { ...start, sampling: "sharp" as const, cleanup: 1, metric: "standard" as const };
    const { tried } = await refine(evaluate, evaluate(sharp)!, objectiveFor("Balanced"), { method: "anneal", budget: 25, seed: 9 });
    for (const t of tried) {
      expect(t.candidate).toMatchObject({ sampling: "sharp", cleanup: 1, metric: "standard", denoise: false, minBeads: 0 });
      expect(t.candidate.dither.mode).toBe("none");
    }
  });

  test("never trades away more likeness than allowed", async () => {
    const evaluate = makeEvaluator(source, base);
    const first = evaluate({ ...start, brightness: 0, maxColors: 24 })!;
    const { best } = await refine(evaluate, first, objectiveFor("Simplest"), { method: "pattern", budget: 60, likenessTolerance: 0.04 });
    expect(likenessCost(best.metrics)).toBeLessThanOrEqual(likenessCost(first.metrics) * 1.04 + 1e-9);
  });

  test("dithered suggestions stay dithered", async () => {
    const evaluate = makeEvaluator(source, base);
    const dithered = { ...start, brightness: 0, dither: { mode: "diffusion" as const, strength: 40 } };
    const { tried } = await refine(evaluate, evaluate(dithered)!, objectiveFor("Smooth shading"), { method: "pattern", budget: 40 });
    expect(tried.every((t) => t.candidate.dither.strength >= 30)).toBe(true);
  });

  test("annealing is repeatable with the same seed", async () => {
    const run = async () => (await refine(makeEvaluator(source, base), makeEvaluator(source, base)(start)!, objectiveFor("Balanced"), { method: "anneal", budget: 20, seed: 5 })).best.candidate;
    expect(await run()).toEqual(await run());
  });

  test("autoSuggest marks fine-tuned suggestions and keeps them distinct", async () => {
    const phases = new Set<string>();
    const out = await autoSuggest(source, base, { space: tiny, count: 3, limit: 100, refine: { method: "pattern", budget: 15 } }, (p) => phases.add(p.phase ?? ""));
    expect(out.length).toBeGreaterThan(0);
    expect(phases.has("search") && phases.has("refine")).toBe(true);
    for (const s of out) if (s.refinedFrom) expect(s.refinedFrom).not.toEqual(s.candidate);
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(difference(out[i]!.pattern, out[j]!.pattern)).toBeGreaterThan(0);
  });

  test("autoSuggest without refinement is just the grid picks", async () => {
    const out = await autoSuggest(source, base, { space: tiny, count: 3, limit: 100, refine: null });
    expect(out.every((s) => !("refinedFrom" in s))).toBe(true);
  });
});

test("fixed costs: lower is better and in sensible ranges", () => {
  const good: Metrics = { colorError: 3, detailError: 4, distanceError: 2, edgeError: 0.03, featureLoss: 0.05, noise: 0.5, toneError: 0.02, colors: 12, beads: 1000, strays: 10, fragmentation: 5 };
  const bad: Metrics = { colorError: 12, detailError: 15, distanceError: 9, edgeError: 0.2, featureLoss: 0.6, noise: 5, toneError: 0.5, colors: 100, beads: 1000, strays: 400, fragmentation: 50 };
  expect(likenessCost(good)).toBeLessThan(likenessCost(bad));
  expect(effortCost(good)).toBeLessThan(effortCost(bad));
  expect(colorCost({ ...good, colors: 2 })).toBeCloseTo(0);
  expect(colorCost({ ...good, colors: 120 })).toBeCloseTo(1);
});

describe("features", () => {
  test("losing an outline raises featureLoss; a faithful copy has none", () => {
    // A dark vertical bar on light: strong edges either side.
    const withBar = makePattern(Array.from({ length: 10 }, () => "aaaabbaaaa"), [mard.find((c) => c.lab[0] > 85)!, mard.find((c) => c.lab[0] < 25)!]);
    const ref = referenceOf(withBar);
    const noBar = makePattern(Array.from({ length: 10 }, () => "aaaaaaaaaa"), [withBar.colors[0]!]);
    expect(scorePattern(withBar, ref).featureLoss).toBeCloseTo(0, 5);
    expect(scorePattern(noBar, ref).featureLoss).toBeGreaterThan(0.5);
  });

  test("a flat original has no features to lose", () => {
    const flat = makePattern(Array.from({ length: 6 }, () => "aaaaaa"));
    expect(scorePattern(flat, referenceOf(flat)).featureLoss).toBe(0);
  });

  test("featureCost grows with lost features, detail error and edge error", () => {
    const base: Metrics = { colorError: 5, detailError: 5, distanceError: 5, edgeError: 0.05, featureLoss: 0.05, noise: 1, toneError: 0.05, colors: 20, beads: 100, strays: 5, fragmentation: 10 };
    expect(featureCost({ ...base, featureLoss: 0.2 })).toBeGreaterThan(featureCost(base));
    expect(featureCost({ ...base, detailError: 9 })).toBeGreaterThan(featureCost(base));
    expect(featureCost({ ...base, edgeError: 0.15 })).toBeGreaterThan(featureCost(base));
  });
});

describe("tuning from picks", () => {
  const img = makeImageData(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const eye = (x - 40) ** 2 + (y - 24) ** 2 < 4 ** 2;
    const stripe = x > 10 && x < 14;
    img.data.set(eye || stripe ? [20, 20, 30, 255] : [120 + x, 90 + y, 150 - x / 2, 255], (y * 64 + x) * 4);
  }
  const source = imageDataSource(img);
  const base: PipelineSettings = { width: 16, sampling: "smooth", denoise: false, trim: false, cleanup: 0, outline: null, crop: FULL_CROP, options: { ...DEFAULT_PATTERN_OPTIONS, palette: mard } };
  const pick: Candidate = { sampling: "smooth", denoise: false, maxColors: 8, dither: { mode: "none", strength: 0 }, cleanup: 1, metric: "standard", minBeads: 0, brightness: 25, contrast: 0, saturation: 0 };

  test("neighbours flip one choice at a time", () => {
    const n = neighbours(pick);
    expect(n.some((c) => c.sampling === "sharp")).toBe(true);
    expect(n.some((c) => c.denoise)).toBe(true);
    expect(n.some((c) => c.metric === "accurate")).toBe(true);
    expect(n.some((c) => c.cleanup === 0) && n.some((c) => c.cleanup === 2)).toBe(true);
    expect(n.some((c) => c.dither.mode === "diffusion")).toBe(true);
    for (const c of n) {
      const diffs = (Object.keys(pick) as (keyof Candidate)[]).filter((k) => JSON.stringify(c[k]) !== JSON.stringify(pick[k]));
      expect(diffs).toHaveLength(1);
    }
  });

  test("keeps the pick's simplicity and doesn't lose features", async () => {
    const evaluate = makeEvaluator(source, base);
    const start = evaluate(pick)!;
    const out = await tuneFromPreferences(source, base, [{ label: "Balanced", candidate: pick }], { count: 1, refine: { method: "pattern", budget: 30 } });
    expect(out).toHaveLength(1);
    expect(out[0]!.label).toBe("Tuned: Balanced");
    expect(effortCost(out[0]!.metrics)).toBeLessThanOrEqual(effortCost(start.metrics) * 1.05 + 1e-9);
    expect(featureCost(out[0]!.metrics)).toBeLessThanOrEqual(featureCost(start.metrics) + 1e-9);
  });

  test("several picks give one result each (unless they end up the same)", async () => {
    const out = await tuneFromPreferences(
      source,
      base,
      [
        { label: "A", candidate: pick },
        { label: "B", candidate: { ...pick, maxColors: 24, cleanup: 0, brightness: 0 } },
      ],
      { count: 2, refine: { method: "pattern", budget: 10 } },
    );
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out.length).toBeLessThanOrEqual(2);
    expect(out.every((s) => s.label.startsWith("Tuned: "))).toBe(true);
  });

  test("one pick gives the tuned version plus distinct variations", async () => {
    const out = await tuneFromPreferences(source, base, [{ label: "Balanced", candidate: pick }], { count: 5, refine: { method: "pattern", budget: 20 } });
    expect(out.length).toBeGreaterThan(1);
    expect(out[0]!.label).toBe("Tuned: Balanced");
    for (const s of out) expect(s.label).toMatch(/^(Tuned|Simpler|More detail|Variation \d+): Balanced$/);
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(difference(out[i]!.pattern, out[j]!.pattern)).toBeGreaterThan(0);
  }, 30000);

  test("pickName strips the variation prefixes", () => {
    expect(pickName("Tuned: Balanced")).toBe("Balanced");
    expect(pickName("Variation 2: Simpler: My settings 1")).toBe("My settings 1");
    expect(pickName("More detail: Crisp")).toBe("Crisp");
    expect(pickName("Most faithful")).toBe("Most faithful");
  });
});

describe("colour tone", () => {
  // Reference: one mid-saturated colour everywhere.
  const ref = makeImageData(6, 6);
  for (let i = 0; i < 36; i++) ref.data.set([180, 110, 90, 255], i * 4);
  const refChroma = Math.hypot(...(rgbLab(180, 110, 90).slice(1) as [number, number]));
  // Bead colours from the chart: the closest greyer, similar and richer versions.
  const byChroma = (target: number) => mard.reduce((a, b) => (Math.abs(Math.hypot(b.lab[1], b.lab[2]) - target) + Math.abs(b.lab[0] - 55) < Math.abs(Math.hypot(a.lab[1], a.lab[2]) - target) + Math.abs(a.lab[0] - 55) ? b : a));
  const flatOf = (c: (typeof mard)[number]) => makePattern(Array(6).fill("aaaaaa"), [c]);
  const muted = flatOf(byChroma(refChroma * 0.6));
  const rich = flatOf(byChroma(refChroma * 1.4));

  test("vivid prefers richer beads, muted prefers softer ones", () => {
    expect(scorePattern(rich, ref, 0, 0, TONE_CHROMA.vivid).toneError).toBeLessThan(scorePattern(muted, ref, 0, 0, TONE_CHROMA.vivid).toneError);
    expect(scorePattern(muted, ref, 0, 0, TONE_CHROMA.muted).toneError).toBeLessThan(scorePattern(rich, ref, 0, 0, TONE_CHROMA.muted).toneError);
  });

  test("tone error is 0 when the intensity matches", () => {
    const exact = flatOf(byChroma(refChroma));
    const m = scorePattern(exact, referenceOf(exact));
    expect(m.toneError).toBeCloseTo(0, 5);
  });

  test("each tone adds saturation values that lead towards it", () => {
    expect(spaceForTone(DEFAULT_SEARCH_SPACE, "natural")).toBe(DEFAULT_SEARCH_SPACE);
    expect(spaceForTone(DEFAULT_SEARCH_SPACE, "vivid").saturation).toEqual(expect.arrayContaining([25, 50]));
    expect(spaceForTone(DEFAULT_SEARCH_SPACE, "muted").saturation).toEqual(expect.arrayContaining([-25, -50]));
  });

  test("autoSuggest groups suggestions by tone, and vivid ends up more colourful than muted", async () => {
    const img = makeImageData(48, 48);
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) img.data.set([170 + x, 100 + y, 80, 255], (y * 48 + x) * 4);
    const base: PipelineSettings = { width: 12, sampling: "smooth", denoise: false, trim: false, cleanup: 0, outline: null, crop: FULL_CROP, options: { ...DEFAULT_PATTERN_OPTIONS, palette: mard } };
    const space: SearchSpace = { ...tiny, saturation: [0], maxColors: [8, 16] };
    const out = await autoSuggest(imageDataSource(img), base, { space, count: 2, limit: 100, tones: ["vivid", "muted"], refine: null });
    const chroma = (p: Pattern) => p.colors.reduce((s, c, i) => s + Math.hypot(c.lab[1], c.lab[2]) * p.counts[i]!, 0) / p.total;
    const vivid = out.filter((s) => s.tone === "vivid");
    const mutedOut = out.filter((s) => s.tone === "muted");
    expect(vivid.length).toBeGreaterThan(0);
    expect(mutedOut.length).toBeGreaterThan(0);
    expect(chroma(vivid[0]!.pattern)).toBeGreaterThan(chroma(mutedOut[0]!.pattern));
  });

  test("tuning a vivid pick stays vivid", async () => {
    const img = makeImageData(48, 48);
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) img.data.set([170 + x, 100 + y, 80, 255], (y * 48 + x) * 4);
    const base: PipelineSettings = { width: 12, sampling: "smooth", denoise: false, trim: false, cleanup: 0, outline: null, crop: FULL_CROP, options: { ...DEFAULT_PATTERN_OPTIONS, palette: mard } };
    const pick: Candidate = { sampling: "smooth", denoise: false, maxColors: 12, dither: { mode: "none", strength: 0 }, cleanup: 0, metric: "standard", minBeads: 0, brightness: 0, contrast: 0, saturation: 30 };
    const [tuned] = await tuneFromPreferences(imageDataSource(img), base, [{ label: "Vivid pick", candidate: pick, tone: "vivid" }], { count: 1, refine: { method: "pattern", budget: 10 } });
    expect(tuned!.tone).toBe("vivid");
  });
});

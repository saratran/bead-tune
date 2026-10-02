import { afterEach, describe, expect, test } from "bun:test";
import { autoSuggest, DEFAULT_SEARCH_SPACE, enumerateCandidates, localEngine, type AutoEngine, type SearchSpace } from "./auto";
import { workerEngine } from "./autoPool";
import { DEFAULT_PATTERN_OPTIONS } from "./pattern";
import type { PipelineSettings } from "./pipeline";
import { FULL_CROP, imageDataSource, makeImageData } from "./sampling";
import { mard } from "../test/fixtures";

// Red disc on a blue gradient.
const img = makeImageData(48, 48);
for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
  const disc = (x - 24) ** 2 + (y - 24) ** 2 < 11 ** 2;
  img.data.set(disc ? [210, 40, 50, 255] : [30, 60 + y, 120 + x, 255], (y * 48 + x) * 4);
}
const source = imageDataSource(img);
const base: PipelineSettings = { width: 12, sampling: "smooth", denoise: false, trim: false, cleanup: 0, outline: null, crop: FULL_CROP, options: { ...DEFAULT_PATTERN_OPTIONS, palette: mard } };
const tiny: SearchSpace = { ...DEFAULT_SEARCH_SPACE, sampling: ["smooth", "sharp"], denoise: [false], maxColors: [6, 12], dither: [{ mode: "none", strength: 0 }], cleanup: [0, 1], metric: ["standard"], minBeads: [0], brightness: [0], contrast: [0], saturation: [0, 20] };
const url = new URL("./autoWorker.ts", import.meta.url).href;

let pool: AutoEngine | null = null;
afterEach(() => pool?.dispose?.());

describe("worker pool", () => {
  test("gives the same results as evaluating on the main thread, in order", async () => {
    pool = await workerEngine(img, base, { url, size: 3 });
    const cs = enumerateCandidates(tiny);
    let seen = 0;
    const [fromPool, local] = await Promise.all([pool.forTone("vivid")(cs, () => seen++), localEngine(source, base).forTone("vivid")(cs)]);
    expect(seen).toBe(cs.length);
    expect(fromPool.map((r) => r?.candidate)).toEqual(local.map((r) => r?.candidate));
    expect(fromPool.map((r) => r?.metrics)).toEqual(local.map((r) => r?.metrics));
    expect(fromPool.map((r) => Array.from(r!.pattern.cells))).toEqual(local.map((r) => Array.from(r!.pattern.cells)));
  }, 30000);

  test("autoSuggest on the pool matches the main thread", async () => {
    pool = await workerEngine(img, base, { url, size: 4 });
    const opts = { space: tiny, count: 3, limit: 100, tones: ["natural", "muted"] as const, refine: { method: "pattern" as const, budget: 12 } };
    const a = await autoSuggest(source, base, { ...opts, tones: [...opts.tones] }, undefined, undefined, pool);
    const b = await autoSuggest(source, base, { ...opts, tones: [...opts.tones] });
    expect(a.map((s) => [s.label, s.tone, s.candidate])).toEqual(b.map((s) => [s.label, s.tone, s.candidate]));
  }, 60000);

  test("Stop skips work that hasn't started, and it can be retried", async () => {
    pool = await workerEngine(img, base, { url, size: 1 });
    const cs = enumerateCandidates(tiny);
    const ctrl = new AbortController();
    const evaluate = pool.forTone("natural");
    const pending = evaluate(cs, () => ctrl.abort(), ctrl.signal);
    const out = await pending;
    expect(out.filter((r) => r === null).length).toBeGreaterThan(0);
    // Skipped ones aren't remembered as empty.
    expect((await evaluate(cs)).every((r) => r !== null)).toBe(true);
  }, 30000);

  test("a worker that can't load rejects, so Auto can fall back", async () => {
    await expect(workerEngine(img, base, { url: new URL("./no-such-worker.ts", import.meta.url).href, size: 1, timeoutMs: 3000 })).rejects.toThrow();
  });
});

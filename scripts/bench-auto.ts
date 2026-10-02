/**
 * Times Auto on a real image: main thread vs the worker pool.
 *
 *   bun scripts/bench-auto.ts <image> [--width 52] [--workers 8] [--tones natural,vivid]
 */
import { autoSuggest, DEFAULT_SEARCH_SPACE, localEngine, type AutoEngine, type ScanProgress, type Tone } from "../src/lib/auto";
import { workerEngine } from "../src/lib/autoPool";
import { BRANDS, DEFAULT_BRAND_ID } from "../src/lib/palettes";
import { DEFAULT_PATTERN_OPTIONS } from "../src/lib/pattern";
import type { PipelineSettings } from "../src/lib/pipeline";
import { FULL_CROP, imageDataSource } from "../src/lib/sampling";
import { decodeImage } from "./decode";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]! : fallback;
};
const input = args.find((a) => !a.startsWith("--") && !/^[\d,a-z]+$/.test(a)) ?? "references/input_1.jpg";
const width = Number(flag("width", "52"));
const tones = flag("tones", "natural").split(",") as Tone[];
const pixels = await decodeImage(input);
const source = imageDataSource(pixels);
const palette = BRANDS.find((b) => b.id === DEFAULT_BRAND_ID)!.colors;
const base: PipelineSettings = { width, sampling: "smooth", denoise: false, trim: false, cleanup: 0, outline: null, crop: FULL_CROP, options: { ...DEFAULT_PATTERN_OPTIONS, palette } };
const options = { space: DEFAULT_SEARCH_SPACE, count: 6, limit: 400, tones, refine: { method: "pattern" as const, budget: 30 } };

async function time(name: string, engine: AutoEngine) {
  const t0 = performance.now();
  const marks: string[] = [];
  let phase = "";
  const onProgress = (p: ScanProgress) => {
    if (p.phase !== phase) marks.push(`${p.phase} @${((performance.now() - t0) / 1000).toFixed(2)}s`);
    phase = p.phase ?? "";
  };
  const out = await autoSuggest(source, base, options, onProgress, undefined, engine);
  console.log(`${name.padEnd(14)} ${((performance.now() - t0) / 1000).toFixed(2)}s  [${marks.join(", ")}]  ${out.map((s) => s.label).join(", ")}`);
  return out;
}

console.log(`${input}: ${pixels.width}×${pixels.height}, ${width} beads, tones ${tones.join("+")}`);
const local = await time("main thread", localEngine(source, base, 1e9));
const size = Number(flag("workers", "8"));
const t0 = performance.now();
const pool = await workerEngine(pixels, base, { url: new URL("../src/lib/autoWorker.ts", import.meta.url).href, size });
console.log(`pool of ${size} started in ${((performance.now() - t0) / 1000).toFixed(2)}s`);
const pooled = await time(`${size} workers`, pool);
pool.dispose?.();
console.log(JSON.stringify(local.map((s) => s.candidate)) === JSON.stringify(pooled.map((s) => s.candidate)) ? "same suggestions" : "DIFFERENT suggestions");

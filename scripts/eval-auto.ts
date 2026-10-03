/**
 * Runs Auto exactly as the app does (grid search + fine-tuning, on the worker pool)
 * over several images, printing each suggestion and writing one contact sheet per image.
 *
 *   bun scripts/eval-auto.ts [images...] [--width 52] [--out auto-eval] [--tones natural] [--preset balanced]
 */
import { mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { autoSuggest, effortCost, featureCost, likenessCost, type RefinedSuggestion, type Tone } from "../src/lib/auto";
import { workerEngine } from "../src/lib/autoPool";
import { BUILT_IN_PRESETS } from "../src/lib/autoPresets";
import { BRANDS, DEFAULT_BRAND_ID } from "../src/lib/palettes";
import { DEFAULT_PATTERN_OPTIONS } from "../src/lib/pattern";
import type { PipelineSettings } from "../src/lib/pipeline";
import { FULL_CROP, imageDataSource, sampleGrid } from "../src/lib/sampling";
import { describeCandidate } from "../src/components/AutoDialog";
import { decodeImage } from "./decode";
import { imageTile, patternTile, writeSheet } from "./sheet";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]! : fallback;
};
const flagged = new Set(args.flatMap((a, i) => (a.startsWith("--") ? [i, i + 1] : [])));
let images = args.filter((a, i) => !flagged.has(i));
if (!images.length) images = [...new Bun.Glob("references/input_*").scanSync()].sort();
const width = Number(flag("width", "52"));
const outDir = flag("out", "auto-eval");
const tones = flag("tones", "natural").split(",") as Tone[];
const preset = BUILT_IN_PRESETS.find((p) => p.id === `builtin:${flag("preset", "balanced")}`)!;
mkdirSync(outDir, { recursive: true });
const palette = BRANDS.find((b) => b.id === DEFAULT_BRAND_ID)!.colors;

const summary: string[] = [];
for (const file of images) {
  const pixels = await decodeImage(file);
  const source = imageDataSource(pixels);
  const base: PipelineSettings = { width, sampling: "smooth", denoise: false, trim: false, cleanup: 0, outline: null, crop: FULL_CROP, options: { ...DEFAULT_PATTERN_OPTIONS, palette } };
  const pool = await workerEngine(pixels, base, { url: new URL("../src/lib/autoWorker.ts", import.meta.url).href });
  const t0 = performance.now();
  const out: RefinedSuggestion[] = await autoSuggest(
    source,
    base,
    { space: preset.space, count: preset.count, limit: preset.limit, tones, refine: preset.refine.enabled ? { method: preset.refine.method, budget: preset.refine.budget } : null },
    undefined,
    undefined,
    pool,
  );
  pool.dispose?.();
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`\n== ${basename(file)} (${secs}s) ==`);
  console.log("#  label            feat like ease | featC  likeC  effC  | key   extr | cols strays frag  settings");
  out.forEach((s, i) => {
    const m = s.metrics;
    console.log(
      `${String(i + 1).padStart(2)} ${s.label.padEnd(16)} ${String(s.features).padStart(4)} ${String(s.likeness).padStart(4)} ${String(s.ease).padStart(4)} | ${featureCost(m).toFixed(3)}  ${likenessCost(m).toFixed(3)}  ${effortCost(m).toFixed(3)} | ${m.keyDetailError.toFixed(1).padStart(4)} ${m.extremeLoss.toFixed(1).padStart(4)} | ${String(m.colors).padStart(4)} ${String(m.strays).padStart(6)} ${m.fragmentation.toFixed(1).padStart(5)}  ${describeCandidate(s.candidate)}`,
    );
  });
  const sheet = join(outDir, `${basename(file).replace(/\.\w+$/, "")}.png`);
  await writeSheet(sheet, [imageTile(sampleGrid(source, width, FULL_CROP, "smooth", false)), ...out.map((s) => patternTile(s.pattern))], 5, 4);
  summary.push(`${basename(file)}: ${out.map((s) => `${s.label} ${s.metrics.colors}c/${s.metrics.strays}s`).join(", ")}`);
}
console.log("\n" + summary.join("\n"));

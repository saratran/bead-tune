/**
 * Developer tool for tuning Auto mode on a real image (macOS: uses `sips` to decode).
 *
 *   bun scripts/tune-auto.ts <image> [--width 52] [--out dir] [--limit 400] [--wide]
 *
 * Prints every suggestion's metrics and writes a contact sheet PNG:
 * the original sampled at bead resolution, then each suggestion in order.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import { rgbToLab } from "../src/lib/color";
import { autoSuggest, DEFAULT_SEARCH_SPACE, effortCost, type Tone, enumerateCandidates, featureCost, likenessToleranceFor, makeEvaluator, objectiveFor, rate, refine, scan, SEARCH_OPTIONS, suggest, tuneFromPreferences, pickName, type Candidate, type SearchSpace } from "../src/lib/auto";
import { BRANDS, DEFAULT_BRAND_ID } from "../src/lib/palettes";
import { DEFAULT_PATTERN_OPTIONS, type Pattern } from "../src/lib/pattern";
import type { PipelineSettings } from "../src/lib/pipeline";
import { FULL_CROP, imageDataSource, makeImageData, sampleGrid } from "../src/lib/sampling";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]! : fallback;
};
const input = args.find((a) => !a.startsWith("--") && !/^\d+$/.test(a));
if (!input) throw new Error("usage: bun scripts/tune-auto.ts <image> [--width 52] [--out dir]");
const width = Number(flag("width", "52"));
const outDir = flag("out", "auto-tune-out");
const limit = Number(flag("limit", "400"));
mkdirSync(outDir, { recursive: true });

// ---- decode via sips → 24-bit BMP (max 1024px), then parse
const bmpPath = join(outDir, "source.bmp");
await $`sips -s format bmp -Z 1024 ${input} --out ${bmpPath}`.quiet();
function readBmp(buf: Uint8Array): ImageData {
  const dv = new DataView(buf.buffer, buf.byteOffset);
  const offset = dv.getUint32(10, true);
  const w = dv.getInt32(18, true);
  const hRaw = dv.getInt32(22, true);
  const bpp = dv.getUint16(28, true);
  const h = Math.abs(hRaw);
  const bytes = bpp / 8;
  const stride = Math.ceil((w * bytes) / 4) * 4;
  const img = makeImageData(w, h);
  for (let y = 0; y < h; y++) {
    const row = hRaw > 0 ? h - 1 - y : y; // bottom-up unless height is negative
    for (let x = 0; x < w; x++) {
      const p = offset + row * stride + x * bytes;
      img.data.set([buf[p + 2]!, buf[p + 1]!, buf[p]!, bytes === 4 ? buf[p + 3]! : 255], (y * w + x) * 4);
    }
  }
  return img;
}
const pixels = readBmp(new Uint8Array(await Bun.file(bmpPath).arrayBuffer()));
const source = imageDataSource(pixels);
console.log(`source ${pixels.width}×${pixels.height}, width ${width} beads`);

// ---- scan
const space: SearchSpace = args.includes("--wide")
  ? {
      ...DEFAULT_SEARCH_SPACE,
      maxColors: [12, 24, 40, 64, 100],
      dither: SEARCH_OPTIONS.dither,
      cleanup: [0, 1, 2],
      contrast: [0, 15, 30],
      saturation: [0, 20, 40],
      brightness: [-10, 0, 10],
    }
  : DEFAULT_SEARCH_SPACE;
if (args.includes("--accurate")) space.metric = ["standard", "accurate"];
const palette = BRANDS.find((b) => b.id === DEFAULT_BRAND_ID)!.colors;
const base: PipelineSettings = { width, sampling: "smooth", denoise: false, trim: false, cleanup: 0, outline: null, crop: FULL_CROP, options: { ...DEFAULT_PATTERN_OPTIONS, palette } };
const candidates = enumerateCandidates(space, limit);
const t0 = performance.now();
const results = await scan(source, base, candidates, undefined, undefined, 1e9);
const ms = performance.now() - t0;
console.log(`${results.length} candidates in ${(ms / 1000).toFixed(1)}s (${(ms / results.length).toFixed(1)} ms each)`);
const suggestions = suggest(rate(results), Number(flag("count", "8")));
let refinedPatterns: Pattern[] = [];

// ---- refinement comparison: same budget, each method, per suggestion
if (args.includes("--compare-refine")) {
  const budget = Number(flag("budget", "40"));
  const evaluate = makeEvaluator(source, base);
  const describe = (from: Candidate, to: Candidate) =>
    (["maxColors", "brightness", "contrast", "saturation"] as const)
      .filter((k) => from[k] !== to[k])
      .map((k) => `${k} ${from[k]}→${to[k]}`)
      .concat(from.dither.strength !== to.dither.strength ? [`dither ${from.dither.strength}→${to.dither.strength}`] : [])
      .join(", ") || "no change";
  console.log(`\nrefinement, budget ${budget} per suggestion (cost: lower is better)`);
  refinedPatterns = [];
  console.log("label            start   pattern(Δ%)            anneal(Δ%)");
  const totals = { pattern: 0, anneal: 0, start: 0, tPattern: 0, tAnneal: 0 };
  for (const sg of suggestions) {
    const objective = objectiveFor(sg.label);
    const startCost = objective(sg.metrics);
    const t0 = performance.now();
    const tol = likenessToleranceFor(sg.label);
    const p = await refine(evaluate, sg, objective, { method: "pattern", budget, likenessTolerance: tol });
    refinedPatterns.push(p.best.pattern);
    const t1 = performance.now();
    const a = await refine(evaluate, sg, objective, { method: "anneal", budget, seed: 7, likenessTolerance: tol });
    const t2 = performance.now();
    const pc = objective(p.best.metrics), ac = objective(a.best.metrics);
    totals.start += startCost; totals.pattern += pc; totals.anneal += ac; totals.tPattern += t1 - t0; totals.tAnneal += t2 - t1;
    const pct = (c: number) => `${(((c - startCost) / startCost) * 100).toFixed(1)}%`.padStart(7);
    console.log(`${sg.label.padEnd(15)} ${startCost.toFixed(4)}  ${pc.toFixed(4)} (${pct(pc)})  ${ac.toFixed(4)} (${pct(ac)})`);
    console.log(`                  pattern: ${describe(sg.candidate, p.best.candidate)}`);
    console.log(`                  anneal:  ${describe(sg.candidate, a.best.candidate)}`);
  }
  console.log(`TOTAL           ${totals.start.toFixed(4)}  ${totals.pattern.toFixed(4)}            ${totals.anneal.toFixed(4)}`);
  console.log(`time: pattern ${(totals.tPattern / 1000).toFixed(1)}s, anneal ${(totals.tAnneal / 1000).toFixed(1)}s (shared cache, so the second run is partly cached)`);
}

const fmt = (n: number, d = 1) => n.toFixed(d).padStart(6);
console.log("\n#  label            feat like ease  colΔE detΔE  distΔE edgeErr featLoss noise cols strays frag  settings");
suggestions.forEach((s, i) => {
  const m = s.metrics, c = s.candidate;
  console.log(
    `${i + 1}  ${s.label.padEnd(15)} ${String(s.features).padStart(4)} ${String(s.likeness).padStart(4)} ${String(s.ease).padStart(4)} ${fmt(m.colorError)} ${fmt(m.detailError)} ${fmt(m.distanceError)} ${fmt(m.edgeError, 3)} ${fmt(m.featureLoss, 3)}  ${fmt(m.noise, 2)} ${String(m.colors).padStart(4)} ${String(m.strays).padStart(6)} ${fmt(m.fragmentation)}  ` +
      `${c.sampling}${c.denoise ? "+denoise" : ""} ${c.maxColors}c ${c.dither.mode}${c.dither.mode !== "none" ? c.dither.strength : ""} clean${c.cleanup} b${c.brightness} c${c.contrast} s${c.saturation} ${c.metric}`,
  );
});

// ---- colour tones: --tones natural,vivid,muted
if (args.includes("--tones")) {
  const tones = flag("tones", "natural,vivid,muted").split(",") as Tone[];
  const t0 = performance.now();
  const out = await autoSuggest(source, base, { space, count: 4, limit, tones, refine: { method: "pattern", budget: 20 } });
  const ref = sampleGrid(source, width, FULL_CROP, "smooth", false);
  let refChroma = 0;
  for (let i = 0; i < ref.width * ref.height; i++) {
    const [, a, b] = rgbToLab(ref.data[i * 4]!, ref.data[i * 4 + 1]!, ref.data[i * 4 + 2]!);
    refChroma += Math.hypot(a, b);
  }
  refChroma /= ref.width * ref.height;
  console.log(`\ntones (${((performance.now() - t0) / 1000).toFixed(1)}s): mean bead chroma = average colour intensity of the beads; original ${refChroma.toFixed(1)}`);
  const chroma = (p: Pattern) => p.colors.reduce((sum, c, i) => sum + Math.hypot(c.lab[1], c.lab[2]) * p.counts[i]!, 0) / Math.max(1, p.total);
  for (const t of tones) {
    const group = out.filter((s) => s.tone === t);
    const avg = group.reduce((n, s) => n + chroma(s.pattern), 0) / Math.max(1, group.length);
    console.log(`${t.padEnd(8)} avg chroma ${avg.toFixed(1)}`);
    for (const s of group) console.log(`   ${s.label.padEnd(15)} chroma ${chroma(s.pattern).toFixed(1).padStart(5)}  sat ${String(s.candidate.saturation).padStart(4)}  contrast ${String(s.candidate.contrast).padStart(4)}  ${s.metrics.colors} colours`);
  }
}

// ---- tuning from the user's picks: --prefer 2,3 (suggestion numbers)
if (args.includes("--prefer")) {
  const picks = flag("prefer", "2").split(",").map((n) => suggestions[Number(n) - 1]!).filter(Boolean);
  const tuned = await tuneFromPreferences(source, base, picks, { count: picks.length, refine: { method: "pattern", budget: Number(flag("budget", "40")) } });
  console.log("\ntuned from picks:");
  for (const t of tuned) {
    const from = picks.find((p) => pickName(t.label) === p.label)!;
    const fm = from.metrics, m = t.metrics;
    console.log(`${t.label.padEnd(22)} featureCost ${featureCost(fm).toFixed(3)} → ${featureCost(m).toFixed(3)}  effort ${effortCost(fm).toFixed(3)} → ${effortCost(m).toFixed(3)}  colours ${fm.colors} → ${m.colors}`);
    console.log(`                       ${JSON.stringify(from.candidate)}\n                     → ${JSON.stringify(t.candidate)}`);
  }
  refinedPatterns = picks.map(() => undefined as unknown as Pattern);
  tuned.forEach((t, i) => (refinedPatterns[i] = t.pattern));
  suggestions.splice(0, suggestions.length, ...picks.flatMap((p, i) => [p, { ...p, pattern: tuned[i]?.pattern ?? p.pattern }]));
  refinedPatterns = suggestions.map((s) => s.pattern);
}

// ---- contact sheet: reference + suggestions, CELL px per bead, GAP between
const CELL = Number(flag("cell", "6")), GAP = 12, PER_ROW = Number(flag("cols", "5"));
const reference = sampleGrid(source, width, FULL_CROP, "smooth", false);
const tiles: { w: number; h: number; px: (x: number, y: number) => [number, number, number] }[] = [
  { w: reference.width, h: reference.height, px: (x, y) => [reference.data[(y * reference.width + x) * 4]!, reference.data[(y * reference.width + x) * 4 + 1]!, reference.data[(y * reference.width + x) * 4 + 2]!] },
  ...suggestions.map((s, i) => {
    const p: Pattern = refinedPatterns[i] || s.pattern;
    return { w: p.width, h: p.height, px: (x: number, y: number): [number, number, number] => {
      const idx = p.cells[y * p.width + x]!;
      return idx < 0 ? [255, 255, 255] : p.colors[idx]!.rgb;
    } };
  }),
];
const tileW = Math.max(...tiles.map((t) => t.w * CELL)), tileH = Math.max(...tiles.map((t) => t.h * CELL));
const rows = Math.ceil(tiles.length / PER_ROW);
const sheetW = Math.min(tiles.length, PER_ROW) * (tileW + GAP) + GAP;
const sheetH = rows * (tileH + GAP) + GAP;
const stride = Math.ceil((sheetW * 3) / 4) * 4;
const bmp = new Uint8Array(54 + stride * sheetH);
const dv = new DataView(bmp.buffer);
bmp.set([0x42, 0x4d]);
dv.setUint32(2, bmp.length, true);
dv.setUint32(10, 54, true);
dv.setUint32(14, 40, true);
dv.setInt32(18, sheetW, true);
dv.setInt32(22, -sheetH, true); // top-down
dv.setUint16(26, 1, true);
dv.setUint16(28, 24, true);
bmp.fill(40, 54); // dark grey background
tiles.forEach((t, n) => {
  const ox = GAP + (n % PER_ROW) * (tileW + GAP);
  const oy = GAP + Math.floor(n / PER_ROW) * (tileH + GAP);
  for (let y = 0; y < t.h * CELL; y++) {
    for (let x = 0; x < t.w * CELL; x++) {
      const [r, g, b] = t.px(Math.floor(x / CELL), Math.floor(y / CELL));
      const edge = x % CELL === CELL - 1 || y % CELL === CELL - 1;
      const p = 54 + (y + oy) * stride + (x + ox) * 3;
      bmp.set(edge ? [b * 0.85, g * 0.85, r * 0.85] : [b, g, r], p);
    }
  }
});
const sheetBmp = join(outDir, "sheet.bmp");
await Bun.write(sheetBmp, bmp);
await $`sips -s format png ${sheetBmp} --out ${join(outDir, "sheet.png")}`.quiet();
console.log(`\ncontact sheet: ${join(outDir, "sheet.png")} (original, then suggestions 1..${suggestions.length})`);

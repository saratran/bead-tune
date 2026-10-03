/**
 * Static build: everything the app needs, in dist/, for any static host (GitHub Pages,
 * Cloudflare Pages, nginx…). Paths are relative, so it also works from a sub-path.
 * Without the Bun server there's no server storage: the app saves projects in the browser.
 *
 *   bun run build
 */
import { rm } from "node:fs/promises";

const outdir = "dist";
await rm(outdir, { recursive: true, force: true });

const pages = await Bun.build({ entrypoints: ["./index.html", "./guide.html"], outdir, minify: true, splitting: true });
// Auto's Web Worker is a separate bundle (the HTML bundler doesn't follow `new Worker(...)`).
const worker = await Bun.build({ entrypoints: ["./src/lib/autoWorker.ts"], outdir, naming: "auto-worker.js", target: "browser", minify: true });

for (const out of [pages, worker]) {
  if (!out.success) {
    for (const log of out.logs) console.error(log);
    process.exit(1);
  }
}
// GitHub Pages: serve files as they are (no Jekyll processing).
await Bun.write(`${outdir}/.nojekyll`, "");
for (const o of [...pages.outputs, ...worker.outputs]) console.log(`  ${o.path.replace(process.cwd() + "/", "")}  ${(o.size / 1024).toFixed(1)} KB`);

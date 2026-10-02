import { mkdirSync } from "node:fs";
import { join } from "node:path";
import index from "./index.html";
import { createProjectsApi } from "./src/server/projectsApi";

// Projects saved "on the server" live in a SQLite file here (a Docker volume in production).
const dataDir = process.env.DATA_DIR ?? "./data";
mkdirSync(dataDir, { recursive: true });
const projects = createProjectsApi(join(dataDir, "projects.sqlite"));

// Auto's Web Worker is its own bundle (the HTML bundler doesn't follow `new Worker(...)`).
// Built once in production; rebuilt on each request in development so edits show up.
const production = process.env.NODE_ENV === "production";
async function buildWorker(): Promise<string> {
  const out = await Bun.build({ entrypoints: [join(import.meta.dir, "src/lib/autoWorker.ts")], target: "browser", minify: production });
  if (!out.success) throw new AggregateError(out.logs, "Building the Auto worker failed");
  return out.outputs[0]!.text();
}
let workerJs: Promise<string> | null = null;
const workerRoute = async () => {
  const js = await (production ? (workerJs ??= buildWorker()) : buildWorker());
  return new Response(js, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" } });
};

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  maxRequestBodySize: 64 * 1024 * 1024,
  routes: {
    "/api/*": (req) => projects.handle(req),
    "/auto-worker.js": workerRoute,
    "/*": index,
  },
  development: !production && {
    hmr: true,
    console: true,
  },
});

console.log(`Bead pattern maker running at ${server.url} (projects stored in ${dataDir})`);

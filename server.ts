import { mkdirSync } from "node:fs";
import { join } from "node:path";
import index from "./index.html";
import { createProjectsApi } from "./src/server/projectsApi";

// Projects saved "on the server" live in a SQLite file here (a Docker volume in production).
const dataDir = process.env.DATA_DIR ?? "./data";
mkdirSync(dataDir, { recursive: true });
const projects = createProjectsApi(join(dataDir, "projects.sqlite"));

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  maxRequestBodySize: 64 * 1024 * 1024,
  routes: {
    "/api/*": (req) => projects.handle(req),
    "/*": index,
  },
  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`Bead pattern maker running at ${server.url} (projects stored in ${dataDir})`);

/**
 * Server-side project storage (SQLite via bun:sqlite).
 *
 *   GET    /api/health
 *   GET    /api/projects               → ProjectMeta[] (newest first, no images)
 *   PUT    /api/projects/:id           ← { name, imageName, thumbnail, state, image?: { type, data(base64) } }
 *   PATCH  /api/projects/:id           ← { name }
 *   DELETE /api/projects/:id
 *   GET    /api/projects/:id/image     → image bytes
 *
 * There is no authentication: it's meant for a home network.
 */
import { Database } from "bun:sqlite";

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_NAME = 200;
const MAX_THUMBNAIL = 2_000_000; // characters of data URL
const MAX_IMAGE_BYTES = 40_000_000;

interface Row {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  thumbnail: string;
  image_name: string;
  state: string;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const fail = (status: number, error: string) => json({ error }, status);

function toMeta(r: Row) {
  return { id: r.id, name: r.name, createdAt: r.created_at, updatedAt: r.updated_at, thumbnail: r.thumbnail, imageName: r.image_name, state: JSON.parse(r.state) };
}

export function createProjectsApi(dbPath: string) {
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      thumbnail TEXT NOT NULL, image_name TEXT NOT NULL, state TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, type TEXT NOT NULL, data BLOB NOT NULL);
  `);

  const q = {
    list: db.query<Row, []>("SELECT * FROM projects ORDER BY updated_at DESC"),
    get: db.query<Row, [string]>("SELECT * FROM projects WHERE id = ?"),
    upsert: db.query(
      `INSERT INTO projects (id, name, created_at, updated_at, thumbnail, image_name, state) VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6)
       ON CONFLICT(id) DO UPDATE SET name = ?2, updated_at = ?3, thumbnail = ?4, image_name = ?5, state = ?6`,
    ),
    putImage: db.query("INSERT INTO images (id, type, data) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET type = ?2, data = ?3"),
    getImage: db.query<{ type: string; data: Uint8Array }, [string]>("SELECT type, data FROM images WHERE id = ?"),
    rename: db.query("UPDATE projects SET name = ?2, updated_at = ?3 WHERE id = ?1"),
    deleteProject: db.query("DELETE FROM projects WHERE id = ?"),
    deleteImage: db.query("DELETE FROM images WHERE id = ?"),
  };

  const save = db.transaction((id: string, body: { name: string; imageName: string; thumbnail: string; state: unknown }, image: { type: string; data: Uint8Array } | null, now: number) => {
    q.upsert.run(id, body.name, now, body.thumbnail, body.imageName, JSON.stringify(body.state));
    if (image) q.putImage.run(id, image.type, image.data);
  });
  const remove = db.transaction((id: string) => {
    q.deleteProject.run(id);
    q.deleteImage.run(id);
  });

  async function readJson(req: Request): Promise<Record<string, unknown> | null> {
    try {
      const body = await req.json();
      return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);

    if (parts[0] === "health" && parts.length === 1 && req.method === "GET") return json({ ok: true });
    if (parts[0] !== "projects") return fail(404, "Not found");

    if (parts.length === 1) {
      if (req.method === "GET") return json(q.list.all().map(toMeta));
      return fail(405, "Method not allowed");
    }

    const id = parts[1]!;
    if (!ID.test(id)) return fail(400, "Invalid project id");

    if (parts.length === 3 && parts[2] === "image" && req.method === "GET") {
      const img = q.getImage.get(id);
      if (!img) return fail(404, "Image not found");
      return new Response(img.data.slice().buffer, { headers: { "Content-Type": img.type, "Cache-Control": "no-store" } });
    }
    if (parts.length !== 2) return fail(404, "Not found");

    if (req.method === "PUT") {
      const body = await readJson(req);
      if (!body) return fail(400, "Expected a JSON body");
      const name = typeof body.name === "string" ? body.name.trim().slice(0, MAX_NAME) || "Untitled" : null;
      const imageName = typeof body.imageName === "string" ? body.imageName.slice(0, MAX_NAME) : "";
      const thumbnail = body.thumbnail;
      if (!name) return fail(400, "Missing name");
      if (typeof thumbnail !== "string" || !thumbnail.startsWith("data:image/") || thumbnail.length > MAX_THUMBNAIL) return fail(400, "Invalid thumbnail");
      if (!body.state || typeof body.state !== "object") return fail(400, "Missing state");

      let image: { type: string; data: Uint8Array } | null = null;
      if (body.image !== undefined) {
        const im = body.image as { type?: unknown; data?: unknown };
        if (typeof im.type !== "string" || !im.type.startsWith("image/") || typeof im.data !== "string") return fail(400, "Invalid image");
        const data = Buffer.from(im.data, "base64");
        if (data.length === 0 || data.length > MAX_IMAGE_BYTES) return fail(413, "Image is empty or too large");
        image = { type: im.type, data: new Uint8Array(data) };
      } else if (!q.get.get(id)) {
        return fail(400, "A new project needs its image");
      }

      save(id, { name, imageName, thumbnail, state: body.state }, image, Date.now());
      return json(toMeta(q.get.get(id)!));
    }

    if (req.method === "PATCH") {
      const body = await readJson(req);
      const name = typeof body?.name === "string" ? body.name.trim().slice(0, MAX_NAME) : "";
      if (!q.get.get(id)) return fail(404, "That project no longer exists.");
      if (name) q.rename.run(id, name, Date.now());
      return json(toMeta(q.get.get(id)!));
    }

    if (req.method === "DELETE") {
      remove(id);
      return new Response(null, { status: 204 });
    }

    return fail(405, "Method not allowed");
  }

  return { handle, close: () => db.close() };
}

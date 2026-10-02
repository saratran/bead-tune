import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createProjectsApi } from "./projectsApi";

let api: ReturnType<typeof createProjectsApi>;
beforeEach(() => {
  api = createProjectsApi(":memory:");
});
afterEach(() => api.close());

const call = (method: string, path: string, body?: unknown) =>
  api.handle(new Request(`http://test${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");
const project = (over: Record<string, unknown> = {}) => ({
  name: "Berry",
  imageName: "berry",
  thumbnail: "data:image/png;base64,AA==",
  state: { version: 1, width: 52 },
  image: { type: "image/png", data: PNG },
  ...over,
});

describe("projects API", () => {
  test("health", async () => {
    expect(await (await call("GET", "/api/health")).json()).toEqual({ ok: true });
  });

  test("save, list and load the image", async () => {
    const res = await call("PUT", "/api/projects/abc", project());
    expect(res.status).toBe(200);
    const saved = await res.json();
    expect(saved).toMatchObject({ id: "abc", name: "Berry", imageName: "berry", state: { version: 1, width: 52 } });
    expect(saved.createdAt).toBe(saved.updatedAt);

    expect((await (await call("GET", "/api/projects")).json()).map((p: { id: string }) => p.id)).toEqual(["abc"]);
    const img = await call("GET", "/api/projects/abc/image");
    expect(img.headers.get("Content-Type")).toBe("image/png");
    expect([...new Uint8Array(await img.arrayBuffer())]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  test("saving again updates it and keeps the creation time; the image is optional then", async () => {
    const first = await (await call("PUT", "/api/projects/abc", project())).json();
    await new Promise((r) => setTimeout(r, 5));
    const { image: _image, ...withoutImage } = project({ name: "Berry 2", state: { version: 1, width: 78 } });
    const second = await (await call("PUT", "/api/projects/abc", withoutImage)).json();
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
    expect(second).toMatchObject({ name: "Berry 2", state: { width: 78 } });
    expect((await call("GET", "/api/projects/abc/image")).status).toBe(200);
  });

  test("lists newest first", async () => {
    await call("PUT", "/api/projects/old", project({ name: "Old" }));
    await new Promise((r) => setTimeout(r, 5));
    await call("PUT", "/api/projects/new", project({ name: "New" }));
    expect((await (await call("GET", "/api/projects")).json()).map((p: { name: string }) => p.name)).toEqual(["New", "Old"]);
  });

  test("rename and delete", async () => {
    await call("PUT", "/api/projects/abc", project());
    expect((await (await call("PATCH", "/api/projects/abc", { name: "  Kitten " })).json()).name).toBe("Kitten");
    expect((await call("PATCH", "/api/projects/nope", { name: "x" })).status).toBe(404);
    expect((await call("DELETE", "/api/projects/abc")).status).toBe(204);
    expect(await (await call("GET", "/api/projects")).json()).toEqual([]);
    expect((await call("GET", "/api/projects/abc/image")).status).toBe(404);
  });

  test("rejects bad input", async () => {
    expect((await call("PUT", "/api/projects/bad id!", project())).status).toBe(400);
    expect((await call("PUT", "/api/projects/abc", project({ thumbnail: "javascript:alert(1)" }))).status).toBe(400);
    expect((await call("PUT", "/api/projects/abc", project({ state: null }))).status).toBe(400);
    expect((await call("PUT", "/api/projects/abc", project({ image: { type: "text/html", data: PNG } }))).status).toBe(400);
    expect((await call("PUT", "/api/projects/abc", project({ image: { type: "image/png", data: "" } }))).status).toBe(413);
    const { image: _image, ...noImage } = project();
    expect((await call("PUT", "/api/projects/new-one", noImage)).status).toBe(400); // a new project needs its image
    const notJson = await api.handle(new Request("http://test/api/projects/abc", { method: "PUT", body: "{oops" }));
    expect(notJson.status).toBe(400);
  });

  test("blank names become Untitled; long names are cut", async () => {
    expect((await (await call("PUT", "/api/projects/a", project({ name: "   " }))).json()).name).toBe("Untitled");
    expect((await (await call("PUT", "/api/projects/b", project({ name: "x".repeat(500) }))).json()).name).toHaveLength(200);
  });

  test("unknown routes and methods", async () => {
    expect((await call("GET", "/api/nope")).status).toBe(404);
    expect((await call("POST", "/api/projects")).status).toBe(405);
    expect((await call("POST", "/api/projects/abc")).status).toBe(405);
  });

  test("data survives reopening the database file", async () => {
    const path = `/tmp/bead-api-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`;
    const a = createProjectsApi(path);
    await a.handle(new Request("http://test/api/projects/keep", { method: "PUT", body: JSON.stringify(project()) }));
    a.close();
    const b = createProjectsApi(path);
    const list = await (await b.handle(new Request("http://test/api/projects"))).json();
    b.close();
    expect(list.map((p: { id: string }) => p.id)).toEqual(["keep"]);
    for (const suffix of ["", "-wal", "-shm"]) await Bun.file(path + suffix).delete().catch(() => {});
  });
});

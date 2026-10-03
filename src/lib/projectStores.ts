/**
 * Where projects can be saved: this browser (IndexedDB) or the app's server.
 * Both expose the same operations so the UI can treat them alike.
 */
import {
  deleteProject,
  listProjects,
  loadProjectImage,
  newId,
  renameProject,
  saveProject,
  type ProjectLocation,
  type ProjectMeta,
  type SaveInput,
} from "./projects";

export interface ProjectStore {
  location: ProjectLocation;
  list(): Promise<ProjectMeta[]>;
  save(input: SaveInput): Promise<ProjectMeta>;
  loadImage(id: string): Promise<Blob | undefined>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
}

const tag = (location: ProjectLocation) => (m: ProjectMeta): ProjectMeta => ({ ...m, location });

export const localStore: ProjectStore = {
  location: "local",
  list: async () => (await listProjects()).map(tag("local")),
  save: async (input) => tag("local")(await saveProject(input)),
  loadImage: loadProjectImage,
  rename: renameProject,
  remove: deleteProject,
};

async function check(res: Response): Promise<Response> {
  if (res.ok) return res;
  let message = `Server error (${res.status})`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {}
  throw new Error(message);
}

function toBase64(bytes: Uint8Array): string {
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(out);
}

/** Projects stored by the app's own server (see src/server/projectsApi.ts). */
/** `base` is relative by default, so a server behind a sub-path works too. */
export function serverStore(base = "."): ProjectStore {
  const api = (path: string) => `${base}/api/projects${path}`;
  return {
    location: "server",
    async list() {
      const res = await check(await fetch(api(""), { cache: "no-store" }));
      return ((await res.json()) as ProjectMeta[]).map(tag("server"));
    },
    async save(input) {
      const id = input.id ?? newId();
      const image = { type: input.image.type || "image/png", data: toBase64(new Uint8Array(await input.image.arrayBuffer())) };
      const res = await check(
        await fetch(api(`/${encodeURIComponent(id)}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: input.name, imageName: input.imageName, thumbnail: input.thumbnail, state: input.state, image }),
        }),
      );
      return tag("server")((await res.json()) as ProjectMeta);
    },
    async loadImage(id) {
      const res = await fetch(api(`/${encodeURIComponent(id)}/image`), { cache: "no-store" });
      if (res.status === 404) return undefined;
      return (await check(res)).blob();
    },
    async rename(id, name) {
      await check(
        await fetch(api(`/${encodeURIComponent(id)}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        }),
      );
    },
    async remove(id) {
      await check(await fetch(api(`/${encodeURIComponent(id)}`), { method: "DELETE" }));
    },
  };
}

export const defaultServerStore = serverStore();

export function storeFor(location: ProjectLocation | undefined): ProjectStore {
  return location === "server" ? defaultServerStore : localStore;
}

/** Whether the server's project storage answers (it doesn't when the app is opened as plain files). */
export async function serverAvailable(base = "."): Promise<boolean> {
  try {
    const res = await fetch(`${base}/api/health`, { cache: "no-store" });
    return res.ok && ((await res.json()) as { ok?: boolean }).ok === true;
  } catch {
    return false;
  }
}

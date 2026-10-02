/**
 * Saved projects, kept in this browser's IndexedDB (images are too big for localStorage).
 * Metadata and images live in separate stores so listing projects doesn't load every image.
 */
import type { ImageSettings } from "../components/ImageOptions";
import type { Crop } from "./sampling";

const DB_NAME = "bead-pattern";
const DB_VERSION = 1;
const META = "projects";
const IMAGES = "images";

/** Everything needed to rebuild a pattern from its image. Colours are stored by id. */
export interface ProjectState {
  version: 1;
  brandId: string;
  width: number;
  boardSize: number;
  image: ImageSettings;
  /** Part of the image used; missing in projects saved before cropping existed (= whole image). */
  crop?: Crop;
  outlineId: string | null;
  ownedOnly: boolean;
  excluded: string[];
  swaps: [from: string, to: string][];
  /** Hand edits for a `w` × `h` grid: cell index → colour id, or null for a removed bead. */
  edits: { w: number; h: number; cells: [index: number, colorId: string | null][] };
}

export type ProjectLocation = "local" | "server";

export interface ProjectMeta {
  id: string;
  /** Where it's stored; set by the store that listed or saved it. */
  location?: ProjectLocation;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Small PNG data URL of the pattern. */
  thumbnail: string;
  imageName: string;
  state: ProjectState;
}

export interface SaveInput {
  /** Existing project to overwrite; omit to create a new one. */
  id?: string;
  name: string;
  image: Blob;
  imageName: string;
  thumbnail: string;
  state: ProjectState;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });
}

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("This browser can't store projects."));
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "id" });
    if (!db.objectStoreNames.contains(IMAGES)) db.createObjectStore(IMAGES, { keyPath: "id" });
  };
  return request(req);
}

async function withStores<T>(mode: IDBTransactionMode, fn: (meta: IDBObjectStore, images: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await openDb();
  try {
    const tx = db.transaction([META, IMAGES], mode);
    const result = await fn(tx.objectStore(META), tx.objectStore(IMAGES));
    await done(tx);
    return result;
  } finally {
    db.close();
  }
}

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** All projects, most recently saved first. */
export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await withStores("readonly", (meta) => request(meta.getAll() as IDBRequest<ProjectMeta[]>));
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Images are stored as raw bytes + type rather than Blobs: some browsers (older
 * iOS Safari) couldn't store Blobs in IndexedDB.
 */
interface ImageRow {
  id: string;
  type: string;
  data: ArrayBuffer;
}

export async function saveProject(input: SaveInput): Promise<ProjectMeta> {
  const now = Date.now();
  const name = input.name.trim() || "Untitled";
  // Read the bytes before opening the transaction: awaiting anything else inside it would let it commit early.
  const data = await input.image.arrayBuffer();
  return withStores("readwrite", async (meta, images) => {
    const existing = input.id ? ((await request(meta.get(input.id))) as ProjectMeta | undefined) : undefined;
    const record: ProjectMeta = {
      id: existing?.id ?? newId(),
      name,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      thumbnail: input.thumbnail,
      imageName: input.imageName,
      state: input.state,
    };
    meta.put(record);
    images.put({ id: record.id, type: input.image.type, data } satisfies ImageRow);
    return record;
  });
}

export async function loadProjectImage(id: string): Promise<Blob | undefined> {
  const row = (await withStores("readonly", (_meta, images) => request(images.get(id)))) as ImageRow | undefined;
  return row ? new Blob([row.data], { type: row.type }) : undefined;
}

export async function renameProject(id: string, name: string): Promise<void> {
  await withStores("readwrite", async (meta) => {
    const existing = (await request(meta.get(id))) as ProjectMeta | undefined;
    if (!existing) throw new Error("That project no longer exists.");
    meta.put({ ...existing, name: name.trim() || existing.name, updatedAt: Date.now() });
  });
}

export async function deleteProject(id: string): Promise<void> {
  await withStores("readwrite", async (meta, images) => {
    meta.delete(id);
    images.delete(id);
  });
}

/**
 * Suggests the next version name: "Berry" → "Berry v2", "Berry v2" → "Berry v3",
 * skipping versions that already exist.
 */
export function nextVersionName(name: string, existing: string[]): string {
  const base = name.replace(/\s+v\d+$/i, "").trim() || "Untitled";
  let max = 1;
  for (const n of existing) {
    const m = /^(.*?)\s+v(\d+)$/i.exec(n.trim());
    if (m && m[1]!.trim() === base) max = Math.max(max, Number(m[2]));
  }
  const own = /\s+v(\d+)$/i.exec(name);
  if (own) max = Math.max(max, Number(own[1]));
  return `${base} v${max + 1}`;
}

/** Ask the browser not to evict saved projects under storage pressure (best effort). */
export function requestPersistentStorage(): void {
  navigator.storage?.persist?.().catch(() => {});
}

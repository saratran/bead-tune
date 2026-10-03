/**
 * Project files (.beadtune): one project — image, settings, edits, bookmarks, build
 * progress — as a single JSON file, to move projects between browsers and devices.
 */
import type { ProjectState } from "./projects";

export const PROJECT_FILE_EXT = ".beadtune";
const FORMAT = "beadtune-project";
const VERSION = 1;

export interface ProjectFileData {
  name: string;
  imageName: string;
  thumbnail: string;
  state: ProjectState;
  image: Blob;
}

interface ProjectFileJson {
  format: typeof FORMAT;
  version: number;
  exportedAt: string;
  name: string;
  imageName: string;
  thumbnail: string;
  state: ProjectState;
  image: { type: string; data: string };
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(data: string, type: string): Blob {
  const s = atob(data);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** The project as a .beadtune file. */
export async function toProjectFile(p: ProjectFileData): Promise<Blob> {
  const json: ProjectFileJson = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    name: p.name,
    imageName: p.imageName,
    thumbnail: p.thumbnail,
    state: p.state,
    image: { type: p.image.type || "image/png", data: await toBase64(p.image) },
  };
  return new Blob([JSON.stringify(json)], { type: "application/json" });
}

/** A file name for the project: its name, made safe, with the .beadtune extension. */
export function projectFileName(name: string): string {
  const safe = name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").slice(0, 100) || "project";
  return `${safe}${PROJECT_FILE_EXT}`;
}

/** Reads a .beadtune file; throws a readable error for anything else. */
export async function parseProjectFile(file: Blob): Promise<ProjectFileData> {
  let json: Partial<ProjectFileJson>;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new Error("That isn't a BeadTune project file.");
  }
  if (json.format !== FORMAT) throw new Error("That isn't a BeadTune project file.");
  if (typeof json.version !== "number" || json.version > VERSION) throw new Error("This project file was made by a newer version of BeadTune.");
  const { name, imageName, thumbnail, state, image } = json;
  if (typeof name !== "string" || !state || typeof state !== "object" || !image || typeof image.data !== "string") {
    throw new Error("This project file is incomplete.");
  }
  if (!Array.isArray(state.edits?.cells) || typeof state.width !== "number" || typeof state.brandId !== "string") {
    throw new Error("This project file is incomplete.");
  }
  return {
    name,
    imageName: typeof imageName === "string" ? imageName : name,
    thumbnail: typeof thumbnail === "string" ? thumbnail : "",
    state,
    image: fromBase64(image.data, typeof image.type === "string" ? image.type : "image/png"),
  };
}

/** Saves a blob as a download. */
export function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

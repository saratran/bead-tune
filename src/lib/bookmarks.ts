/**
 * Bookmarked Auto suggestions. Stored per image (by a fingerprint of its
 * pixels), so they survive new Auto runs, reloads and reopening the image.
 */
import type { Candidate, Tone } from "./auto";
import { FULL_CROP, type ImageSource } from "./sampling";

export interface Bookmark {
  id: string;
  label: string;
  candidate: Candidate;
  /** PNG data URL of the pattern when it was bookmarked. */
  thumbnail: string;
  /** Scores within the scan it came from (features is missing on older bookmarks). */
  features?: number;
  likeness: number;
  ease: number;
  colors: number;
  beads: number;
  strays: number;
  createdAt: number;
  /** Scored on a fixed scale (your own settings), not relative to an Auto search. */
  fixedScale?: boolean;
  /** The colour tone it was chosen for (natural if missing). */
  tone?: Tone;
  /** What the pattern was made with; applying it later uses your current width and bead set. */
  context: { width: number; brandId: string };
}

const KEY = "bead-pattern:bookmarks";
/** Keep at most this many bookmarks per image. */
export const MAX_PER_IMAGE = 50;

/** A short hash of the image shrunk to 16×16, insensitive to tiny re-encoding differences. */
export function imageFingerprint(source: ImageSource): string {
  const { data } = source.scaled(16, 16, FULL_CROP);
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i]! >> 3;
    h = Math.imul(h, 0x01000193);
  }
  return `${source.width}x${source.height}-${(h >>> 0).toString(16)}`;
}

export const sameCandidate = (a: Candidate, b: Candidate) => JSON.stringify(a) === JSON.stringify(b);

function readAll(): Record<string, Bookmark[]> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Bookmark[]>;
  } catch {
    return {};
  }
}

export function loadBookmarks(fingerprint: string): Bookmark[] {
  return readAll()[fingerprint] ?? [];
}

export function saveBookmarks(fingerprint: string, list: Bookmark[]): void {
  const all = readAll();
  if (list.length) all[fingerprint] = list.slice(-MAX_PER_IMAGE);
  else delete all[fingerprint];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage full: keep the newest half for this image and try once more.
    all[fingerprint] = list.slice(-Math.ceil(MAX_PER_IMAGE / 2));
    try {
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch {}
  }
}

/** Adds `extra` bookmarks that aren't already in `list` (same settings = same bookmark). */
export function mergeBookmarks(list: Bookmark[], extra: Bookmark[]): Bookmark[] {
  const out = [...list];
  for (const b of extra) if (!out.some((o) => sameCandidate(o.candidate, b.candidate))) out.push(b);
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

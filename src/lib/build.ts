/** Build mode: the pattern split into pegboards, and which beads have been placed. */
import type { Pattern } from "./pattern";

export interface Board {
  /** Position in reading order (left to right, top to bottom). */
  index: number;
  /** Column and row of the board. */
  bx: number;
  by: number;
  /** Its area in the pattern, in beads. */
  x0: number;
  y0: number;
  w: number;
  h: number;
}

/** The pegboards covering the pattern, in reading order. Edge boards may be partly used. */
export function boardsOf(p: Pattern, size: number): Board[] {
  const out: Board[] = [];
  const cols = Math.ceil(p.width / size), rows = Math.ceil(p.height / size);
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const x0 = bx * size, y0 = by * size;
      out.push({ index: out.length, bx, by, x0, y0, w: Math.min(size, p.width - x0), h: Math.min(size, p.height - y0) });
    }
  }
  return out;
}

/** Pattern cell indices on a board that have a bead. */
export function beadsOn(p: Pattern, b: Board): number[] {
  const out: number[] = [];
  for (let y = b.y0; y < b.y0 + b.h; y++) {
    for (let x = b.x0; x < b.x0 + b.w; x++) {
      const i = y * p.width + x;
      if (p.cells[i]! >= 0) out.push(i);
    }
  }
  return out;
}

/** Beads still to place on a board, per colour index (only colours that are on it), most first. */
export function leftOn(p: Pattern, b: Board, placed: ReadonlySet<number>): { colour: number; left: number; total: number }[] {
  const left = new Map<number, number>(), total = new Map<number, number>();
  for (const i of beadsOn(p, b)) {
    const c = p.cells[i]!;
    total.set(c, (total.get(c) ?? 0) + 1);
    if (!placed.has(i)) left.set(c, (left.get(c) ?? 0) + 1);
  }
  return [...total]
    .map(([colour, t]) => ({ colour, left: left.get(colour) ?? 0, total: t }))
    .sort((a, b) => b.left - a.left || b.total - a.total || a.colour - b.colour);
}

/** Placed beads out of all beads in the pattern. */
export function progressOf(p: Pattern, placed: ReadonlySet<number>): { placed: number; total: number } {
  let n = 0;
  for (const i of placed) if (p.cells[i]! >= 0) n++;
  return { placed: n, total: p.total };
}

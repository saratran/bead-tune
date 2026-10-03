/** Geometry for the bead editor: brush footprints, straight lines, fills. All in cell indices. */
import type { Pattern } from "./pattern";

/** Brush sizes offered (beads across; the brush is a square). */
export const BRUSH_SIZES = [1, 2, 3, 5] as const;
export type BrushSize = (typeof BRUSH_SIZES)[number];

/** Cells covered by a `size` × `size` brush at `index` (centred; even sizes lean up-left). */
export function brushCells(index: number, w: number, h: number, size: number): number[] {
  const x0 = (index % w) - Math.floor((size - 1) / 2);
  const y0 = Math.floor(index / w) - Math.floor((size - 1) / 2);
  const out: number[] = [];
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) if (x >= 0 && y >= 0 && x < w && y < h) out.push(y * w + x);
  }
  return out;
}

/** Cells on a straight line from `a` to `b` (Bresenham), both ends included. */
export function lineCells(a: number, b: number, w: number): number[] {
  let x0 = a % w, y0 = Math.floor(a / w);
  const x1 = b % w, y1 = Math.floor(b / w);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const out: number[] = [];
  for (;;) {
    out.push(y0 * w + x0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return out;
}

/** The brush footprint along a line from `a` to `b` (no duplicates). */
export function strokeCells(a: number, b: number, w: number, h: number, size: number): number[] {
  const seen = new Set<number>();
  for (const c of lineCells(a, b, w)) for (const i of brushCells(c, w, h, size)) seen.add(i);
  return [...seen];
}

/** Same id for empty cells and for each colour (by bead id, so swapped palettes compare right). */
function colourAt(p: Pattern, i: number): string {
  const idx = p.cells[i]!;
  return idx < 0 ? "" : p.colors[idx]!.id;
}

/** The connected area (4-neighbours) of cells the same colour as `index` — a paint-bucket fill. */
export function fillCells(p: Pattern, index: number): number[] {
  const { width: w, height: h } = p;
  const target = colourAt(p, index);
  const seen = new Uint8Array(w * h);
  const stack = [index];
  seen[index] = 1;
  const out: number[] = [];
  while (stack.length) {
    const i = stack.pop()!;
    out.push(i);
    const x = i % w, y = (i / w) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j >= 0 && !seen[j] && colourAt(p, j) === target) {
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  return out;
}

/** Every cell the same colour as `index`, anywhere in the pattern. */
export function sameColourCells(p: Pattern, index: number): number[] {
  const target = colourAt(p, index);
  const out: number[] = [];
  for (let i = 0; i < p.cells.length; i++) if (colourAt(p, i) === target) out.push(i);
  return out;
}

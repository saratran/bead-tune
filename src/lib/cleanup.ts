/** Post-processing on a finished bead grid: tidying, trimming, outlining and hand edits. */
import type { BeadColor } from "./palettes";
import { EMPTY, fromIndices, type Pattern } from "./pattern";

/** Cells as indices into a palette made of the pattern's colours (empty stays -1). */
function editable(p: Pattern): { raw: Int16Array; palette: BeadColor[] } {
  return { raw: Int16Array.from(p.cells), palette: [...p.colors] };
}

function neighbours4(i: number, w: number, h: number): number[] {
  const x = i % w;
  const y = (i / w) | 0;
  const out: number[] = [];
  if (x > 0) out.push(i - 1);
  if (x < w - 1) out.push(i + 1);
  if (y > 0) out.push(i - w);
  if (y < h - 1) out.push(i + w);
  return out;
}

/**
 * Removes speckle: every connected group of at most `maxSize` same-coloured
 * cells (empty counts as a colour) takes the most common colour around it.
 * Lone beads in the background disappear and pinholes in solid areas fill in.
 */
export function removeStrays(p: Pattern, maxSize: number): Pattern {
  if (maxSize < 1) return p;
  const { width: w, height: h } = p;
  const { raw, palette } = editable(p);
  const seen = new Uint8Array(raw.length);

  for (let start = 0; start < raw.length; start++) {
    if (seen[start]) continue;
    const value = raw[start]!;
    const group = [start];
    seen[start] = 1;
    for (let q = 0; q < group.length && group.length <= maxSize; q++) {
      for (const j of neighbours4(group[q]!, w, h)) {
        if (!seen[j] && raw[j] === value) {
          seen[j] = 1;
          group.push(j);
        }
      }
    }
    if (group.length > maxSize) {
      // Big region: finish marking it so its cells aren't re-examined.
      for (let q = 0; q < group.length; q++) {
        for (const j of neighbours4(group[q]!, w, h)) {
          if (!seen[j] && raw[j] === value) {
            seen[j] = 1;
            group.push(j);
          }
        }
      }
      continue;
    }

    const around = new Map<number, number>();
    const inGroup = new Set(group);
    for (const i of group) {
      for (const j of neighbours4(i, w, h)) {
        if (!inGroup.has(j)) around.set(raw[j]!, (around.get(raw[j]!) ?? 0) + 1);
      }
    }
    let best: number | undefined;
    let bestCount = 0;
    for (const [v, n] of around) {
      if (n > bestCount) {
        best = v;
        bestCount = n;
      }
    }
    if (best !== undefined) for (const i of group) raw[i] = best;
  }
  return fromIndices(w, h, raw, palette);
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Smallest box containing every bead, or null if there are none. */
export function contentBox(p: Pattern): Box | null {
  let x0 = p.width, y0 = p.height, x1 = -1, y1 = -1;
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      if (p.cells[y * p.width + x] === EMPTY) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Copies `box` out of the pattern. Parts outside the pattern become empty. */
export function cropPattern(p: Pattern, box: Box): Pattern {
  const raw = new Int16Array(box.w * box.h).fill(EMPTY);
  for (let y = 0; y < box.h; y++) {
    for (let x = 0; x < box.w; x++) {
      const sx = box.x + x;
      const sy = box.y + y;
      if (sx >= 0 && sy >= 0 && sx < p.width && sy < p.height) raw[y * box.w + x] = p.cells[sy * p.width + sx]!;
    }
  }
  return fromIndices(box.w, box.h, raw, p.colors);
}

/** Removes empty rows and columns around the beads. */
export function trimPattern(p: Pattern): Pattern {
  const box = contentBox(p);
  if (!box || (box.w === p.width && box.h === p.height)) return p;
  return cropPattern(p, box);
}

/** Adds `n` empty cells on every side. */
export function padPattern(p: Pattern, n: number): Pattern {
  return cropPattern(p, { x: -n, y: -n, w: p.width + 2 * n, h: p.height + 2 * n });
}

/** Empty cells connected to the pattern's edge through other empty cells (the outside). */
export function exteriorCells(p: Pattern): Uint8Array {
  const { width: w, height: h } = p;
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (i: number) => {
    if (p.cells[i] === EMPTY && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (y > 0) seed(i - w);
    if (y < h - 1) seed(i + w);
  }
  return outside;
}

/**
 * Where a one-bead outline goes: every *outside* empty cell that touches a bead
 * (including diagonally). Holes inside the shape are left alone. `clipped` is
 * true when beads touch the grid's edge, so the outline can't go all the way round.
 */
export function outlineRing(p: Pattern): { cells: number[]; clipped: boolean } {
  const { width: w, height: h } = p;
  const outside = exteriorCells(p);
  const cells: number[] = [];
  let clipped = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (p.cells[i] !== EMPTY && (x === 0 || y === 0 || x === w - 1 || y === h - 1)) clipped = true;
      if (!outside[i]) continue;
      let touches = false;
      for (let dy = -1; dy <= 1 && !touches; dy++) {
        for (let dx = -1; dx <= 1 && !touches; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          touches = xx >= 0 && yy >= 0 && xx < w && yy < h && p.cells[yy * w + xx] !== EMPTY;
        }
      }
      if (touches) cells.push(i);
    }
  }
  return { cells, clipped };
}

/** Draws a one-bead outline of `color` around the shape (see `outlineRing`). */
export function addOutline(p: Pattern, color: BeadColor): Pattern {
  return applyEdits(p, new Map(outlineRing(p).cells.map((i) => [i, color])));
}

/** Hand edits: cell index → colour to paint, or null to remove the bead. */
export type Edits = Map<number, BeadColor | null>;

export function applyEdits(p: Pattern, edits: Edits): Pattern {
  if (edits.size === 0) return p;
  const { raw, palette } = editable(p);
  const indexOf = new Map(palette.map((c, i) => [c.id, i]));
  for (const [cell, color] of edits) {
    if (cell < 0 || cell >= raw.length) continue;
    if (!color) {
      raw[cell] = EMPTY;
      continue;
    }
    let idx = indexOf.get(color.id);
    if (idx === undefined) {
      idx = palette.length;
      palette.push(color);
      indexOf.set(color.id, idx);
    }
    raw[cell] = idx;
  }
  return fromIndices(p.width, p.height, raw, palette);
}

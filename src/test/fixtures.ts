import { BRANDS, type BeadColor } from "../lib/palettes";
import type { Pattern } from "../lib/pattern";

export const perler = BRANDS.find((b) => b.id === "perler")!.colors;
export const mard = BRANDS.find((b) => b.id === "mard-221")!.colors;

/**
 * Builds a pattern from rows of single characters: "." is empty, any other
 * character picks a colour by first appearance (a → colors[0], b → colors[1], ...).
 */
export function makePattern(rows: string[], colors: BeadColor[] = mard): Pattern {
  const width = rows[0]!.length;
  const height = rows.length;
  const letters: string[] = [];
  const cells = new Int16Array(width * height);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === ".") {
        cells[y * width + x] = -1;
        return;
      }
      if (!letters.includes(ch)) letters.push(ch);
      cells[y * width + x] = letters.indexOf(ch);
    }),
  );
  const counts = letters.map((_, i) => cells.filter((c) => c === i).length);
  return { width, height, cells, colors: letters.map((_, i) => colors[i]!), counts, total: counts.reduce((a, b) => a + b, 0) };
}

/** A filled square pattern of `n` × `n` beads, two colours in a checkerboard. */
export function checker(n: number): Pattern {
  return makePattern(Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => ((x + y) % 2 ? "a" : "b")).join("")));
}

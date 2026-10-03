import { describe, expect, test } from "bun:test";
import { makePattern } from "../test/fixtures";
import { beadsOn, boardsOf, leftOn, progressOf } from "./build";

describe("build mode helpers", () => {
  // 5 × 3 pattern on 2-peg boards: 3 columns × 2 rows of boards (edges partly used).
  const p = makePattern(["aab.b", "abb.a", "....a"]);

  test("boards in reading order, edge boards cut to the pattern", () => {
    const boards = boardsOf(p, 2);
    expect(boards.map((b) => [b.bx, b.by, b.w, b.h])).toEqual([
      [0, 0, 2, 2],
      [1, 0, 2, 2],
      [2, 0, 1, 2],
      [0, 1, 2, 1],
      [1, 1, 2, 1],
      [2, 1, 1, 1],
    ]);
  });

  test("beads on a board skip empty pegs", () => {
    const [first, second] = boardsOf(p, 2);
    expect(beadsOn(p, first!)).toEqual([0, 1, 5, 6]);
    expect(beadsOn(p, second!)).toEqual([2, 7]);
  });

  test("beads left per colour, and overall progress", () => {
    const first = boardsOf(p, 2)[0]!;
    const a = p.colors.findIndex((c) => c.id === p.colors[p.cells[0]!]!.id);
    const left = leftOn(p, first, new Set([0]));
    expect(left.find((l) => l.colour === a)).toEqual({ colour: a, left: 2, total: 3 });
    expect(progressOf(p, new Set([0, 1, 3]))).toEqual({ placed: 2, total: p.total }); // 3 is an empty peg
  });
});

import { describe, expect, test } from "bun:test";
import { makePattern, mard } from "../test/fixtures";
import { addOutline, applyEdits, contentBox, cropPattern, exteriorCells, padPattern, removeStrays, trimPattern } from "./cleanup";
import type { Pattern } from "./pattern";

/** Back to rows of letters (a = first colour of `ref`), for readable assertions. */
function rows(p: Pattern, ref = mard): string[] {
  return Array.from({ length: p.height }, (_, y) =>
    Array.from({ length: p.width }, (_, x) => {
      const idx = p.cells[y * p.width + x]!;
      return idx < 0 ? "." : String.fromCharCode(97 + ref.indexOf(p.colors[idx]!));
    }).join(""),
  );
}

describe("removeStrays", () => {
  test("a lone bead takes the surrounding colour", () => {
    const p = removeStrays(makePattern(["aaa", "aba", "aaa"]), 1);
    expect(rows(p)).toEqual(["aaa", "aaa", "aaa"]);
    expect(p.colors.length).toBe(1);
  });

  test("respects the group size", () => {
    const pair = makePattern(["aaaa", "abba", "aaaa"]);
    expect(rows(removeStrays(pair, 1))).toEqual(["aaaa", "abba", "aaaa"]);
    expect(rows(removeStrays(pair, 2))).toEqual(["aaaa", "aaaa", "aaaa"]);
  });

  test("a lone bead in the background disappears", () => {
    const p = removeStrays(makePattern(["...", ".a.", "..."]), 1);
    expect(p.total).toBe(0);
  });

  test("with keepContrast, a lone bead much darker or lighter than its surroundings stays (eyes, sparkles)", () => {
    const byL = [...mard].sort((x, y) => x.lab[0] - y.lab[0]);
    const light = byL[byL.length - 1]!, dark = byL[0]!;
    const near = byL.find((c) => c !== light && light.lab[0] - c.lab[0] < 10)!;
    // "a" is the first colour given, "b" the second.
    const eye = makePattern(["aaa", "aba", "aaa"], [light, dark]);
    expect(rows(removeStrays(eye, 1, 30), [light, dark])).toEqual(["aaa", "aba", "aaa"]); // kept
    expect(rows(removeStrays(eye, 1), [light, dark])).toEqual(["aaa", "aaa", "aaa"]); // without keepContrast: removed
    const speck = makePattern(["aaa", "aba", "aaa"], [light, near]);
    expect(rows(removeStrays(speck, 1, 30), [light, near])).toEqual(["aaa", "aaa", "aaa"]); // low contrast: still speckle
  });

  test("pinholes in a solid area fill in", () => {
    expect(rows(removeStrays(makePattern(["aaa", "a.a", "aaa"]), 1))).toEqual(["aaa", "aaa", "aaa"]);
  });

  test("large regions are left alone", () => {
    const halves = makePattern(["aabb", "aabb", "aabb"]);
    expect(rows(removeStrays(halves, 3))).toEqual(rows(halves));
  });

  test("takes the majority of the neighbours", () => {
    // The stray c touches a three times (left, above, below) and b once (right).
    const p = removeStrays(makePattern(["aab", "acb", "aab"]), 1);
    expect(rows(p)[1]).toBe("aab");
  });

  test("0 is off", () => {
    const p = makePattern(["aba"]);
    expect(removeStrays(p, 0)).toBe(p);
  });
});

describe("trimming and cropping", () => {
  const framed = makePattern(["....", ".ab.", ".ba.", "...."]);

  test("contentBox finds the beads", () => {
    expect(contentBox(framed)).toEqual({ x: 1, y: 1, w: 2, h: 2 });
    expect(contentBox(makePattern(["..", ".."]))).toBeNull();
  });

  test("trimPattern removes empty rows and columns", () => {
    expect(rows(trimPattern(framed))).toEqual(["ab", "ba"]);
  });

  test("trimPattern leaves full or empty patterns alone", () => {
    const full = makePattern(["ab"]);
    expect(trimPattern(full)).toBe(full);
    const empty = makePattern([".."]);
    expect(trimPattern(empty)).toBe(empty);
  });

  test("padPattern adds empty space on every side", () => {
    expect(rows(padPattern(makePattern(["a"]), 1))).toEqual(["...", ".a.", "..."]);
  });

  test("cropPattern fills outside areas with empty", () => {
    expect(rows(cropPattern(makePattern(["ab"]), { x: 1, y: 0, w: 2, h: 1 }))).toEqual(["b."]);
  });
});

describe("addOutline", () => {
  const outline = mard[5]!; // "f"

  test("surrounds beads, including diagonals", () => {
    const p = addOutline(makePattern([".....", ".....", "..a..", ".....", "....."]), outline);
    expect(rows(p)).toEqual([".....", ".fff.", ".faf.", ".fff.", "....."]);
    expect(p.counts[p.colors.indexOf(outline)]).toBe(8);
  });

  test("reuses the colour if the pattern already has it", () => {
    const p = addOutline(makePattern(["...", ".a.", "..."]), mard[0]!);
    expect(p.colors.length).toBe(1);
    expect(p.total).toBe(9);
  });

  test("does nothing without empty space", () => {
    expect(rows(addOutline(makePattern(["ab", "ba"]), outline))).toEqual(["ab", "ba"]);
  });
});

describe("applyEdits", () => {
  const p = makePattern(["ab", "a."]);

  test("paints, erases and adds new colours", () => {
    const edited = applyEdits(
      p,
      new Map([
        [1, mard[0]!], // b → a
        [2, null], // remove
        [3, mard[7]!], // new colour on an empty peg
      ]),
    );
    expect(rows(edited)).toEqual(["aa", ".h"]);
    expect(edited.total).toBe(3);
  });

  test("ignores cells outside the pattern", () => {
    expect(rows(applyEdits(p, new Map([[99, mard[3]!]])))).toEqual(["ab", "a."]);
  });

  test("no edits returns the same pattern", () => {
    expect(applyEdits(p, new Map())).toBe(p);
  });
});

describe("outline only outside the shape", () => {
  const outline = mard[5]!; // "f"

  test("holes inside the shape stay empty", () => {
    const ring = makePattern([".......", ".aaaaa.", ".a...a.", ".a...a.", ".a...a.", ".aaaaa.", "......."]);
    expect(rows(addOutline(ring, outline))).toEqual(["fffffff", "faaaaaf", "fa...af", "fa...af", "fa...af", "faaaaaf", "fffffff"]);
  });

  test("exteriorCells marks empty cells reachable from the edge", () => {
    const p = makePattern([".aaa.", ".a.a.", ".aaa."]);
    const outside = exteriorCells(p);
    expect(outside[0]).toBe(1); // corner
    expect(outside[7]).toBe(0); // enclosed hole at (2,1)
    expect(outside[6]).toBe(0); // a bead
  });
});

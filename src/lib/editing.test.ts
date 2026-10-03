import { describe, expect, test } from "bun:test";
import { makePattern } from "../test/fixtures";
import { brushCells, fillCells, lineCells, sameColourCells, strokeCells } from "./editing";

describe("editor geometry", () => {
  test("brush squares are centred and clipped at the edges", () => {
    // 5 × 5 grid; cell 12 is the middle.
    expect(brushCells(12, 5, 5, 1)).toEqual([12]);
    expect(brushCells(12, 5, 5, 3).sort((a, b) => a - b)).toEqual([6, 7, 8, 11, 12, 13, 16, 17, 18]);
    expect(brushCells(0, 5, 5, 3).sort((a, b) => a - b)).toEqual([0, 1, 5, 6]);
    expect(brushCells(12, 5, 5, 2).sort((a, b) => a - b)).toEqual([12, 13, 17, 18]);
  });

  test("lines include both ends and every cell between", () => {
    expect(lineCells(0, 4, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(lineCells(0, 24, 5)).toEqual([0, 6, 12, 18, 24]);
    expect(lineCells(3, 3, 5)).toEqual([3]);
  });

  test("a stroke covers the brush along the line, without duplicates", () => {
    const cells = strokeCells(0, 2, 5, 5, 3);
    expect(new Set(cells).size).toBe(cells.length);
    expect(cells.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 5, 6, 7, 8]);
  });

  test("fill takes the connected area; replace takes every bead of the colour", () => {
    const p = makePattern(["aab", "bab", "aaa"]);
    expect(fillCells(p, 0).sort((a, b) => a - b)).toEqual([0, 1, 4, 6, 7, 8]);
    expect(fillCells(p, 2).sort((a, b) => a - b)).toEqual([2, 5]);
    expect(sameColourCells(p, 2).sort((a, b) => a - b)).toEqual([2, 3, 5]);
  });

  test("fill works on empty pegs too", () => {
    const p = makePattern(["a..", "a.a", "aaa"]);
    expect(fillCells(p, 1).sort((a, b) => a - b)).toEqual([1, 2, 4]);
  });
});

import { describe, expect, test } from "bun:test";
import { mockContext } from "../test/canvas-mock";
import { makePattern } from "../test/fixtures";
import { drawCells, drawGrid, drawPattern, type CellShape } from "./render";

const ctx2d = (m: ReturnType<typeof mockContext>) => m as unknown as CanvasRenderingContext2D;

// 3 beads (a, b, a) and 1 empty peg.
const p = makePattern(["ab", "a."]);
const [colA, colB] = p.colors;

describe("drawCells", () => {
  test("square: one filled rect per bead, at cell positions", () => {
    const m = mockContext();
    drawCells(ctx2d(m), p, { cell: 10, shape: "square", codes: false });
    const rects = m.named("fillRect");
    expect(rects.map((c) => c.args)).toEqual([
      [0, 0, 10, 10],
      [10, 0, 10, 10],
      [0, 10, 10, 10],
    ]);
    expect(rects.map((c) => c.state.fillStyle)).toEqual([colA!.hex, colB!.hex, colA!.hex]);
  });

  test.each<[CellShape, number]>([
    ["circle", 3],
    ["bead", 6], // body + hole per bead
  ])("%s draws %i arcs and no rects", (shape, arcs) => {
    const m = mockContext();
    drawCells(ctx2d(m), p, { cell: 20, shape, codes: false });
    expect(m.named("arc").length).toBe(arcs);
    expect(m.named("fillRect").length).toBe(0);
  });

  test("cross strokes two diagonals per bead", () => {
    const m = mockContext();
    drawCells(ctx2d(m), p, { cell: 20, shape: "cross", codes: false });
    expect(m.named("stroke").length).toBe(3);
    expect(m.named("moveTo").length).toBe(6);
  });

  test("bead shape draws peg dots for empty cells when a peg colour is given", () => {
    const m = mockContext();
    drawCells(ctx2d(m), p, { cell: 20, shape: "bead", codes: false, pegColor: "#123456" });
    const pegArcs = m.named("arc").filter((c) => c.state.fillStyle === "#123456");
    expect(pegArcs.length).toBe(1);
    expect(pegArcs[0]!.args.slice(0, 2)).toEqual([30, 30]); // centre of the empty cell (1, 1)
  });

  test("tiny cells fall back to squares", () => {
    const m = mockContext();
    drawCells(ctx2d(m), p, { cell: 5, shape: "bead", codes: false });
    expect(m.named("fillRect").length).toBe(3);
    expect(m.named("arc").length).toBe(0);
  });

  test("codes are drawn centred on each bead", () => {
    const m = mockContext();
    drawCells(ctx2d(m), p, { cell: 30, shape: "square", codes: true });
    expect(m.texts()).toEqual([colA!.code, colB!.code, colA!.code]);
    const [, x, y] = m.named("fillText")[0]!.args as [string, number, number];
    expect(x).toBe(15);
    expect(y).toBeCloseTo(15.9);
  });

  test("codes are skipped when they would be unreadably small", () => {
    const m = mockContext();
    drawCells(ctx2d(m), p, { cell: 10, shape: "square", codes: true });
    expect(m.texts()).toEqual([]);
  });

  test("long codes shrink to fit the cell", () => {
    const m = mockContext();
    const long = { ...colA!, code: "80-15179" };
    drawCells(ctx2d(m), { ...p, colors: [long, colB!] }, { cell: 30, shape: "square", codes: true });
    const longFont = m.named("fillText").find((c) => c.args[0] === "80-15179")!.state.font;
    const shortFont = m.named("fillText").find((c) => c.args[0] === colB!.code)!.state.font;
    const px = (f: string) => Number(/([\d.]+)px/.exec(f)![1]);
    expect(px(longFont)).toBeLessThan(px(shortFont));
    expect(8 * px(longFont) * 0.6).toBeLessThanOrEqual(30 * 0.9 + 1e-9);
  });

  test("highlight dims every other colour", () => {
    const m = mockContext();
    drawCells(ctx2d(m), p, { cell: 10, shape: "square", codes: false, highlightId: colB!.id });
    const alphaByColour = m.named("fillRect").map((c) => [c.state.fillStyle, c.state.globalAlpha]);
    expect(alphaByColour).toEqual([
      [colA!.hex, 0.12],
      [colB!.hex, 1],
      [colA!.hex, 0.12],
    ]);
    expect(m.globalAlpha).toBe(1); // restored afterwards
  });

  test("shadow paints an offset copy under every bead first", () => {
    const m = mockContext();
    drawCells(ctx2d(m), p, { cell: 10, shape: "square", codes: false, shadow: true });
    const rects = m.named("fillRect");
    expect(rects.length).toBe(6);
    expect(rects.slice(0, 3).every((c) => c.state.fillStyle === "rgba(0, 0, 0, 0.28)")).toBe(true);
    const [sx, sy] = rects[0]!.args as number[];
    expect(sx).toBeCloseTo(0.7);
    expect(sy).toBeCloseTo(1);
  });

  test("region draws only that part, relative to the origin", () => {
    const m = mockContext();
    drawCells(ctx2d(m), p, { cell: 10, shape: "square", codes: false, region: { x: 1, y: 0, w: 1, h: 2 } });
    const rects = m.named("fillRect");
    expect(rects.map((c) => c.args)).toEqual([[0, 0, 10, 10]]); // (1,0) = b; (1,1) is empty
    expect(rects[0]!.state.fillStyle).toBe(colB!.hex);
  });
});

test("drawGrid draws w+1 vertical and h+1 horizontal lines, extended past the edges", () => {
  const m = mockContext();
  drawGrid(ctx2d(m), 3, 2, 10, "#ccc", 5);
  const moves = m.named("moveTo").map((c) => c.args);
  expect(moves.length).toBe(4 + 3);
  expect(moves[0]).toEqual([0, -5]);
  expect(moves[4]).toEqual([-5, 0]);
  expect(m.named("lineTo")[0]!.args).toEqual([0, 25]);
});

describe("drawPattern (on-screen)", () => {
  const big = makePattern(["abab", "baba", "abab", "baba"]);
  const base = { cell: 10, shape: "square" as const, codes: false, boardSize: 2, showBoards: false };

  test("fills the background first", () => {
    const m = mockContext();
    drawPattern(ctx2d(m), big, { ...base, background: "#101010" });
    expect(m.named("fillRect")[0]!.args).toEqual([0, 0, 40, 40]);
    expect(m.named("fillRect")[0]!.state.fillStyle).toBe("#101010");
  });

  test("board lines are dashed and only drawn when enabled", () => {
    const off = mockContext();
    drawPattern(ctx2d(off), big, base);
    expect(off.named("setLineDash").length).toBe(0);

    const on = mockContext();
    drawPattern(ctx2d(on), big, { ...base, showBoards: true });
    expect(on.named("setLineDash").map((c) => c.args[0])).toEqual([[5, 10 / 3], []]);
  });

  test("square cells get a grid, beads don't", () => {
    const sq = mockContext();
    drawPattern(ctx2d(sq), big, base);
    expect(sq.named("moveTo").length).toBe(10);

    const bead = mockContext();
    drawPattern(ctx2d(bead), big, { ...base, shape: "bead" });
    expect(bead.named("moveTo").length).toBe(0);
  });
});

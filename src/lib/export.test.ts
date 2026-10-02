import { describe, expect, test } from "bun:test";
import { contextOf } from "../test/canvas-mock";
import { checker, makePattern } from "../test/fixtures";
import { boardRegions, buildExportFile, composeExport, DEFAULT_EXPORT, type ExportSettings } from "./export";

const allOff: ExportSettings = {
  ...DEFAULT_EXPORT,
  size: "S",
  grid: false,
  analysis: false,
  counts: false,
  codes: false,
  title: false,
};

// 10 × 8, two colours.
const p = makePattern(Array.from({ length: 8 }, (_, y) => (y < 4 ? "aaaaabbbbb" : "bbbbbbbbbb")));

describe("boardRegions", () => {
  test("splits an exact multiple into equal boards, row by row", () => {
    const boards = boardRegions(checker(52), 26);
    expect(boards.map((b) => b.label)).toEqual(["Board 1/4", "Board 2/4", "Board 3/4", "Board 4/4"]);
    expect(boards[1]!.region).toEqual({ x: 26, y: 0, w: 26, h: 26 });
    expect(boards[3]!.region).toEqual({ x: 26, y: 26, w: 26, h: 26 });
  });

  test("clips partial boards at the right and bottom edges", () => {
    const boards = boardRegions(makePattern(Array(10).fill("a".repeat(30))), 26);
    expect(boards.map((b) => b.region)).toEqual([
      { x: 0, y: 0, w: 26, h: 10 },
      { x: 26, y: 0, w: 4, h: 10 },
    ]);
  });

  test("a pattern smaller than one board is one board", () => {
    expect(boardRegions(p, 26)).toHaveLength(1);
  });
});

describe("composeExport layout", () => {
  // Size S = 18px cells, padding = round(18 × 0.6) = 11px.
  test("bare pattern is the grid plus padding", () => {
    const c = composeExport(p, allOff);
    expect([c.width, c.height]).toEqual([10 * 18 + 22, 8 * 18 + 22]);
  });

  test("analysis diagram adds a one-cell gutter on every side", () => {
    const c = composeExport(p, { ...allOff, analysis: true });
    expect([c.width, c.height]).toEqual([202 + 36, 166 + 36]);
  });

  test("title adds height only", () => {
    const c = composeExport(p, { ...allOff, title: true });
    expect([c.width, c.height]).toEqual([202, 166 + 27]);
  });

  test("count summary adds rows of chips below", () => {
    const one = composeExport(makePattern(["a"]), { ...allOff, counts: true });
    const many = composeExport(makePattern(["abcdefghij"]), { ...allOff, counts: true });
    const bare = composeExport(makePattern(["abcdefghij"]), allOff);
    expect(one.height).toBeGreaterThan(composeExport(makePattern(["a"]), allOff).height);
    expect(many.height).toBeGreaterThan(bare.height);
    expect(many.width).toBe(bare.width);
  });

  test.each([
    ["L", 40],
    ["M", 28],
    ["S", 18],
  ] as const)("size %s uses %ipx cells", (size, cell) => {
    const c = composeExport(p, { ...allOff, size });
    expect(c.width).toBe(10 * cell + 2 * Math.round(cell * 0.6));
  });

  test("maxCell caps the cell size (used by the preview)", () => {
    const c = composeExport(p, { ...allOff, size: "L" }, { maxCell: 10 });
    expect(c.width).toBe(10 * 10 + 12);
  });

  test("huge patterns are scaled down to stay under the canvas limit", () => {
    const c = composeExport(checker(300), { ...DEFAULT_EXPORT, size: "L" });
    expect(Math.max(c.width, c.height)).toBeLessThanOrEqual(8000);
  });
});

describe("composeExport content", () => {
  test("title shows name and stats", () => {
    const texts = contextOf(composeExport(p, { ...allOff, title: true, titleText: "Strawberry" })).texts();
    expect(texts).toContain("Strawberry  [10×8 / 2 colours / 80 beads]");
  });

  test("blank title falls back to a default name", () => {
    const texts = contextOf(composeExport(p, { ...allOff, title: true })).texts();
    expect(texts[0]).toStartWith("Bead pattern  [");
  });

  test("subtitle and stats describe only the exported region", () => {
    const texts = contextOf(
      composeExport(p, { ...allOff, title: true, titleText: "X" }, { region: { x: 0, y: 0, w: 5, h: 4 }, subtitle: "Board 1/2" }),
    ).texts();
    expect(texts[0]).toBe("X  Board 1/2  [5×4 / 1 colours / 20 beads]");
  });

  test("analysis labels every row and column on both sides", () => {
    const texts = contextOf(composeExport(p, { ...allOff, analysis: true })).texts();
    for (let i = 1; i <= 10; i++) expect(texts.filter((t) => t === String(i)).length).toBe(i <= 8 ? 4 : 2);
  });

  test("analysis guides: dashed every 5, red every 10", () => {
    const wide = makePattern(["a".repeat(12)]);
    const m = contextOf(composeExport(wide, { ...allOff, analysis: true }));
    const strokes = m.named("stroke").map((c) => c.state.strokeStyle);
    expect(strokes).toContain("#e0393e");
    expect(strokes).toContain("#2a2833");
  });

  test("split boards keep global coordinates in their labels", () => {
    const texts = contextOf(composeExport(checker(52), { ...allOff, analysis: true }, { region: { x: 26, y: 26, w: 26, h: 26 } })).texts();
    expect(texts).toContain("27");
    expect(texts).toContain("52");
    expect(texts).not.toContain("1");
  });

  test("codes are drawn when enabled", () => {
    const on = contextOf(composeExport(p, { ...allOff, size: "L", codes: true })).texts();
    const off = contextOf(composeExport(p, { ...allOff, size: "L" })).texts();
    expect(on.filter((t) => t === p.colors[0]!.code).length).toBe(20);
    expect(off).toEqual([]);
  });

  test("count summary lists each colour's code and count", () => {
    const texts = contextOf(composeExport(p, { ...allOff, counts: true })).texts();
    expect(texts).toEqual([p.colors[0]!.code, "20", p.colors[1]!.code, "60"]);
  });

  test("watermark needs both the toggle and some text", () => {
    const draw = (s: Partial<ExportSettings>) => contextOf(composeExport(p, { ...allOff, ...s })).texts();
    expect(draw({ watermark: true, watermarkText: "my-shop" })).toContain("my-shop");
    expect(draw({ watermark: true, watermarkText: "   " })).toEqual([]);
    expect(draw({ watermark: false, watermarkText: "my-shop" })).toEqual([]);
  });

  test("background is always white so exports print well", () => {
    const first = contextOf(composeExport(p, allOff)).named("fillRect")[0]!;
    expect(first.state.fillStyle).toBe("#ffffff");
  });
});

describe("buildExportFile", () => {
  const pdfPages = async (f: File) => ((await f.text()).match(/\/Type \/Page\b/g) ?? []).length;

  test("PNG", async () => {
    const f = await buildExportFile(p, { ...DEFAULT_EXPORT, format: "png" }, 26, "strawberry");
    expect(f.name).toBe("strawberry.png");
    expect(f.type).toBe("image/png");
    expect(f.size).toBeGreaterThan(0);
  });

  test("PDF on one page", async () => {
    const f = await buildExportFile(checker(52), { ...DEFAULT_EXPORT, format: "pdf", size: "S" }, 26, "x");
    expect(f.name).toBe("x.pdf");
    expect(f.type).toBe("application/pdf");
    expect(await f.text()).toStartWith("%PDF-");
    expect(await pdfPages(f)).toBe(1);
  });

  test("PDF with one page per pegboard", async () => {
    const f = await buildExportFile(checker(52), { ...DEFAULT_EXPORT, format: "pdf", size: "S", splitBoards: true }, 26, "x");
    expect(await pdfPages(f)).toBe(4);
  });

  test("split is ignored when the pattern fits on one board", async () => {
    const f = await buildExportFile(p, { ...DEFAULT_EXPORT, format: "pdf", size: "S", splitBoards: true }, 26, "x");
    expect(await pdfPages(f)).toBe(1);
  });
});

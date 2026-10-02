import { contrastText } from "./color";
import type { Pattern } from "./pattern";
import type { BeadColor } from "./palettes";
import { CANVAS_FONT, drawCells, drawGrid, fullRegion, type CellShape, type Region } from "./render";

export type ExportFormat = "png" | "pdf";
export type ExportSize = "L" | "M" | "S";

export interface ExportSettings {
  format: ExportFormat;
  size: ExportSize;
  shape: CellShape;
  grid: boolean;
  /** Row/column numbers on all sides plus guide lines every 5 and 10 beads. */
  analysis: boolean;
  counts: boolean;
  codes: boolean;
  title: boolean;
  titleText: string;
  watermark: boolean;
  watermarkText: string;
  shadow: boolean;
  /** PDF only: one page per pegboard instead of the whole pattern on one page. */
  splitBoards: boolean;
}

export const DEFAULT_EXPORT: ExportSettings = {
  format: "png",
  size: "L",
  shape: "square",
  grid: true,
  analysis: true,
  counts: true,
  codes: true,
  title: true,
  titleText: "",
  watermark: false,
  watermarkText: "",
  shadow: false,
  splitBoards: false,
};

const CELL_PX: Record<ExportSize, number> = { L: 40, M: 28, S: 18 };
const MAX_SIDE_PX = 8000;

// Exports are always light: they get printed and shared.
const INK = "#1d1b26";
const PAPER = "#ffffff";
const GUTTER = "#ececf0";
const GUTTER_INK = "#5d5a66";
const GRID = "rgba(0, 0, 0, 0.18)";
const GUIDE_5 = "#2a2833";
const GUIDE_10 = "#e0393e";
const WATERMARK = "rgba(224, 57, 90, 0.16)";

function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, maxWidth: number): string {
  ctx.font = `${weight} ${size}px ${CANVAS_FONT}`;
  const w = ctx.measureText(text).width;
  const fitted = w > maxWidth ? (size * maxWidth) / w : size;
  return `${weight} ${fitted}px ${CANVAS_FONT}`;
}

function countRegion(p: Pattern, r: Region): { colors: BeadColor[]; counts: number[]; total: number } {
  const counts = new Array<number>(p.colors.length).fill(0);
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const idx = p.cells[y * p.width + x]!;
      if (idx >= 0) counts[idx] = counts[idx]! + 1;
    }
  }
  const used = p.colors.map((c, i) => ({ c, n: counts[i]! })).filter((e) => e.n > 0);
  return { colors: used.map((e) => e.c), counts: used.map((e) => e.n), total: used.reduce((s, e) => s + e.n, 0) };
}

export interface ComposeOptions {
  region?: Region;
  /** Appended to the title, e.g. "Board 2 of 4". */
  subtitle?: string;
  /** Cap the cell size (used for the fast on-screen preview). */
  maxCell?: number;
}

export function composeExport(p: Pattern, s: ExportSettings, opts: ComposeOptions = {}): HTMLCanvasElement {
  const r = opts.region ?? fullRegion(p);
  const cell = Math.max(4, Math.min(CELL_PX[s.size], opts.maxCell ?? Infinity, Math.floor(MAX_SIDE_PX / Math.max(r.w, r.h) / 1.2)));
  const pad = Math.round(cell * 0.6);
  const gut = s.analysis ? cell : 0;
  const gridW = r.w * cell;
  const gridH = r.h * cell;
  const contentW = gridW + gut * 2;
  const titleH = s.title ? Math.round(cell * 1.5) : 0;

  const summary = countRegion(p, r);
  const chipH = Math.round(cell * 1.1);
  const chipW = Math.round(cell * 3.6);
  const gap = Math.round(cell * 0.35);
  const cols = Math.max(1, Math.floor((contentW + gap) / (chipW + gap)));
  const rows = Math.ceil(summary.colors.length / cols);
  const summaryH = s.counts && rows > 0 ? gap * 2 + rows * (chipH + gap) - gap : 0;

  const canvas = document.createElement("canvas");
  canvas.width = contentW + pad * 2;
  canvas.height = pad + titleH + gut * 2 + gridH + summaryH + pad;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Title: "Name [W×H / N colours / T beads]"
  if (s.title) {
    const name = s.titleText.trim() || "Bead pattern";
    const stats = `[${r.w}×${r.h} / ${summary.colors.length} colours / ${summary.total.toLocaleString()} beads]`;
    const text = [name, opts.subtitle, stats].filter(Boolean).join("  ");
    ctx.font = fitFont(ctx, text, 800, cell * 0.75, contentW);
    ctx.fillStyle = INK;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, pad, pad + titleH / 2);
  }

  const gx = pad + gut;
  const gy = pad + titleH + gut;

  if (s.analysis) {
    ctx.fillStyle = GUTTER;
    ctx.fillRect(pad, gy - gut, contentW, gut);
    ctx.fillRect(pad, gy + gridH, contentW, gut);
    ctx.fillRect(pad, gy, gut, gridH);
    ctx.fillRect(gx + gridW, gy, gut, gridH);
    ctx.fillStyle = GUTTER_INK;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${cell * 0.38}px ${CANVAS_FONT}`;
    for (let i = 0; i < r.w; i++) {
      const label = String(r.x + i + 1);
      const x = gx + i * cell + cell / 2;
      ctx.fillText(label, x, gy - gut / 2);
      ctx.fillText(label, x, gy + gridH + gut / 2);
    }
    for (let j = 0; j < r.h; j++) {
      const label = String(r.y + j + 1);
      const y = gy + j * cell + cell / 2;
      ctx.fillText(label, pad + gut / 2, y);
      ctx.fillText(label, gx + gridW + gut / 2, y);
    }
  }

  ctx.save();
  ctx.translate(gx, gy);
  ctx.beginPath();
  ctx.rect(0, 0, gridW, gridH);
  ctx.clip();
  drawCells(ctx, p, { cell, shape: s.shape, codes: s.codes, shadow: s.shadow, region: r, pegColor: "#e6e4ea" });
  ctx.restore();

  ctx.save();
  ctx.translate(gx, gy);
  if (s.grid) drawGrid(ctx, r.w, r.h, cell, GRID, gut);

  if (s.analysis) {
    // Guides on global coordinates so split boards line up with the full pattern.
    const line = (vertical: boolean, at: number, major: boolean) => {
      ctx.strokeStyle = major ? GUIDE_10 : GUIDE_5;
      ctx.lineWidth = major ? Math.max(2, cell / 14) : Math.max(1.5, cell / 20);
      ctx.setLineDash(major ? [] : [cell * 0.14, cell * 0.12]);
      ctx.beginPath();
      if (vertical) {
        ctx.moveTo(at, -gut);
        ctx.lineTo(at, gridH + gut);
      } else {
        ctx.moveTo(-gut, at);
        ctx.lineTo(gridW + gut, at);
      }
      ctx.stroke();
    };
    for (let i = 1; i < r.w; i++) if ((r.x + i) % 5 === 0) line(true, i * cell, (r.x + i) % 10 === 0);
    for (let j = 1; j < r.h; j++) if ((r.y + j) % 5 === 0) line(false, j * cell, (r.y + j) % 10 === 0);
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
  ctx.lineWidth = Math.max(1, cell / 24);
  ctx.strokeRect(0, 0, gridW, gridH);

  if (s.watermark && s.watermarkText.trim()) {
    const text = s.watermarkText.trim();
    ctx.translate(gridW / 2, gridH / 2);
    ctx.rotate(-Math.atan2(gridH, gridW) * 0.6);
    ctx.font = `800 100px ${CANVAS_FONT}`;
    const size = Math.min((100 * Math.hypot(gridW, gridH) * 0.6) / ctx.measureText(text).width, gridH * 0.5);
    ctx.font = `800 ${size}px ${CANVAS_FONT}`;
    ctx.fillStyle = WATERMARK;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 0, 0);
  }
  ctx.restore();

  if (summaryH > 0) {
    const top = gy + gridH + gut + gap * 2;
    const radius = cell * 0.14;
    summary.colors.forEach((c, i) => {
      const x = pad + (i % cols) * (chipW + gap);
      const y = top + Math.floor(i / cols) * (chipH + gap);
      const half = Math.round(chipW * 0.52);
      ctx.fillStyle = PAPER;
      ctx.beginPath();
      ctx.roundRect(x, y, chipW, chipH, radius);
      ctx.fill();
      ctx.fillStyle = c.hex;
      ctx.beginPath();
      ctx.roundRect(x, y, half, chipH, [radius, 0, 0, radius]);
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
      ctx.lineWidth = Math.max(1, cell / 28);
      ctx.beginPath();
      ctx.roundRect(x, y, chipW, chipH, radius);
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = contrastText(c.rgb);
      ctx.font = fitFont(ctx, c.code, 800, cell * 0.5, half - cell * 0.2);
      ctx.fillText(c.code, x + half / 2, y + chipH / 2);
      const count = summary.counts[i]!.toLocaleString();
      ctx.fillStyle = INK;
      ctx.font = fitFont(ctx, count, 800, cell * 0.5, chipW - half - cell * 0.2);
      ctx.fillText(count, x + half + (chipW - half) / 2, y + chipH / 2);
    });
  }

  return canvas;
}

export function boardRegions(p: Pattern, boardSize: number): { region: Region; label: string }[] {
  const bx = Math.ceil(p.width / boardSize);
  const by = Math.ceil(p.height / boardSize);
  const out: { region: Region; label: string }[] = [];
  for (let j = 0; j < by; j++) {
    for (let i = 0; i < bx; i++) {
      const x = i * boardSize;
      const y = j * boardSize;
      out.push({
        region: { x, y, w: Math.min(boardSize, p.width - x), h: Math.min(boardSize, p.height - y) },
        label: `Board ${j * bx + i + 1}/${bx * by}`,
      });
    }
  }
  return out;
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't encode the image."))), "image/png"),
  );
}

/** Renders the export and returns it as a file (PNG image or PDF document). */
export async function buildExportFile(p: Pattern, s: ExportSettings, boardSize: number, baseName: string): Promise<File> {
  if (s.format === "png") {
    const blob = await canvasBlob(composeExport(p, s));
    return new File([blob], `${baseName}.png`, { type: "image/png" });
  }

  const { jsPDF } = await import("jspdf");
  const pages =
    s.splitBoards && (p.width > boardSize || p.height > boardSize)
      ? boardRegions(p, boardSize).map((b) => composeExport(p, s, { region: b.region, subtitle: b.label }))
      : [composeExport(p, s)];
  let doc: InstanceType<typeof jsPDF> | undefined;
  for (const canvas of pages) {
    const size: [number, number] = [canvas.width, canvas.height];
    const orientation = canvas.width > canvas.height ? "landscape" : "portrait";
    if (!doc) doc = new jsPDF({ unit: "px", format: size, orientation, compress: true, hotfixes: ["px_scaling"] });
    else doc.addPage(size, orientation);
    doc.addImage(canvas, "PNG", 0, 0, canvas.width, canvas.height, undefined, "FAST");
  }
  return new File([doc!.output("blob")], `${baseName}.pdf`, { type: "application/pdf" });
}

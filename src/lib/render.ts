import { contrastText, shade } from "./color";
import type { Pattern } from "./pattern";

export type CellShape = "square" | "bead" | "cross" | "circle";
export const CELL_SHAPES: CellShape[] = ["square", "bead", "cross", "circle"];

export const CANVAS_FONT = '"Nunito", system-ui, -apple-system, sans-serif';

/** A rectangle of the pattern, in bead coordinates. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function fullRegion(p: Pattern): Region {
  return { x: 0, y: 0, w: p.width, h: p.height };
}

export interface CellOptions {
  cell: number;
  shape: CellShape;
  codes: boolean;
  shadow?: boolean;
  highlightId?: string | null;
  /** Peg dot colour for empty cells (bead shape only). */
  pegColor?: string;
  region?: Region;
}

const SHADOW = "rgba(0, 0, 0, 0.28)";

function paint(ctx: CanvasRenderingContext2D, shape: CellShape, x: number, y: number, cell: number, color: string, hole?: string) {
  const cx = x + cell / 2;
  const cy = y + cell / 2;
  switch (shape) {
    case "square":
      ctx.fillStyle = color;
      ctx.fillRect(x, y, cell, cell);
      break;
    case "circle":
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.45, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "bead":
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.47, 0, Math.PI * 2);
      ctx.fill();
      if (hole) {
        // Faint rim so light beads don't read as empty pegs.
        ctx.strokeStyle = "rgba(0, 0, 0, 0.14)";
        ctx.lineWidth = Math.max(0.5, cell / 24);
        ctx.stroke();
        ctx.fillStyle = hole;
        ctx.beginPath();
        ctx.arc(cx, cy, cell * 0.17, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case "cross": {
      const inset = cell * 0.2;
      ctx.strokeStyle = color;
      ctx.lineWidth = cell * 0.2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x + inset, y + inset);
      ctx.lineTo(x + cell - inset, y + cell - inset);
      ctx.moveTo(x + cell - inset, y + inset);
      ctx.lineTo(x + inset, y + cell - inset);
      ctx.stroke();
      break;
    }
  }
}

/** Draws the beads of `region` with its top-left at the current origin. Does not fill a background. */
export function drawCells(ctx: CanvasRenderingContext2D, p: Pattern, o: CellOptions): void {
  const r = o.region ?? fullRegion(p);
  const { cell } = o;
  // Shapes other than squares turn to mush at tiny sizes.
  const shape: CellShape = cell < 6 ? "square" : o.shape;
  const highlightIdx = o.highlightId ? p.colors.findIndex((c) => c.id === o.highlightId) : -1;
  const holes = p.colors.map((c) => shade(c.rgb, 0.35));
  const each = (fn: (idx: number, x: number, y: number) => void) => {
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const idx = p.cells[(r.y + y) * p.width + r.x + x];
        if (idx !== undefined) fn(idx, x * cell, y * cell);
      }
    }
  };

  if (shape === "bead" && o.pegColor) {
    ctx.fillStyle = o.pegColor;
    each((idx, x, y) => {
      if (idx >= 0) return;
      ctx.beginPath();
      ctx.arc(x + cell / 2, y + cell / 2, cell * 0.12, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  if (o.shadow) {
    const dx = cell * 0.07;
    const dy = cell * 0.1;
    each((idx, x, y) => idx >= 0 && paint(ctx, shape, x + dx, y + dy, cell, SHADOW));
  }

  each((idx, x, y) => {
    if (idx < 0) return;
    ctx.globalAlpha = highlightIdx >= 0 && idx !== highlightIdx ? 0.12 : 1;
    paint(ctx, shape, x, y, cell, p.colors[idx]!.hex, holes[idx]);
  });
  ctx.globalAlpha = 1;

  if (o.codes) {
    // Fit each code to the cell; skip text that would be unreadably small.
    const base = cell * 0.38;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const fonts = p.colors.map((c) => {
      ctx.font = `700 ${base}px ${CANVAS_FONT}`;
      const size = Math.min(base, (base * cell * 0.9) / ctx.measureText(c.code).width);
      return size >= 5 ? `700 ${size}px ${CANVAS_FONT}` : null;
    });
    const inks = p.colors.map((c) => (shape === "cross" ? "#1d1b26" : contrastText(c.rgb)));
    each((idx, x, y) => {
      const font = idx >= 0 ? fonts[idx] : null;
      if (!font) return;
      ctx.globalAlpha = highlightIdx >= 0 && idx !== highlightIdx ? 0.12 : 1;
      ctx.font = font;
      ctx.fillStyle = inks[idx]!;
      ctx.fillText(p.colors[idx]!.code, x + cell / 2, y + cell / 2 + cell * 0.03);
    });
    ctx.globalAlpha = 1;
  }
}

/** Thin lines between every cell, spanning `extend` px past the grid on each side. */
export function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, cell: number, color: string, extend = 0): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, cell / 28);
  ctx.beginPath();
  for (let x = 0; x <= w; x++) {
    ctx.moveTo(x * cell, -extend);
    ctx.lineTo(x * cell, h * cell + extend);
  }
  for (let y = 0; y <= h; y++) {
    ctx.moveTo(-extend, y * cell);
    ctx.lineTo(w * cell + extend, y * cell);
  }
  ctx.stroke();
}

export interface DisplayOptions {
  cell: number;
  shape: CellShape;
  codes: boolean;
  boardSize: number;
  showBoards: boolean;
  highlightId?: string | null;
  background?: string;
  pegColor?: string;
  gridColor?: string;
  boardLineColor?: string;
}

/** On-screen pattern preview. */
export function drawPattern(ctx: CanvasRenderingContext2D, p: Pattern, o: DisplayOptions): void {
  const { cell } = o;
  const W = p.width * cell;
  const H = p.height * cell;
  ctx.fillStyle = o.background ?? "#f6f3ee";
  ctx.fillRect(0, 0, W, H);

  drawCells(ctx, p, { cell, shape: o.shape, codes: o.codes, highlightId: o.highlightId, pegColor: o.pegColor ?? "#e4ded4" });

  if (o.shape !== "bead" && cell >= 8) drawGrid(ctx, p.width, p.height, cell, o.gridColor ?? "rgba(0, 0, 0, 0.12)");

  if (o.showBoards) {
    ctx.strokeStyle = o.boardLineColor ?? "rgba(40, 30, 70, 0.55)";
    ctx.lineWidth = Math.max(1, cell / 10);
    ctx.setLineDash([cell / 2, cell / 3]);
    ctx.beginPath();
    for (let x = o.boardSize; x < p.width; x += o.boardSize) {
      ctx.moveTo(x * cell, 0);
      ctx.lineTo(x * cell, H);
    }
    for (let y = o.boardSize; y < p.height; y += o.boardSize) {
      ctx.moveTo(0, y * cell);
      ctx.lineTo(W, y * cell);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** Small square-cell picture of a pattern as a PNG data URL (for lists and bookmarks). */
export function patternThumbnail(p: Pattern, size = 160): string {
  const cell = Math.max(1, Math.floor(size / Math.max(p.width, p.height)));
  const canvas = document.createElement("canvas");
  canvas.width = p.width * cell;
  canvas.height = p.height * cell;
  drawPattern(canvas.getContext("2d")!, p, {
    cell,
    shape: "square",
    codes: false,
    boardSize: p.width,
    showBoards: false,
    background: "#ffffff",
    gridColor: "rgba(0, 0, 0, 0)",
  });
  return canvas.toDataURL("image/png");
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

import { shade } from "./color";
import type { Pattern } from "./pattern";

export interface DrawOptions {
  cell: number;
  boardSize: number;
  showBoards: boolean;
  highlightId?: string | null;
  pegColor?: string;
  background?: string;
  boardLineColor?: string;
}

export function drawPattern(ctx: CanvasRenderingContext2D, p: Pattern, o: DrawOptions): void {
  const { cell } = o;
  const W = p.width * cell;
  const H = p.height * cell;
  ctx.fillStyle = o.background ?? "#f6f3ee";
  ctx.fillRect(0, 0, W, H);

  const asSquares = cell < 7;
  const r = cell * 0.47;
  const hole = cell * 0.17;
  const holeColors = p.colors.map((c) => shade(c.rgb, 0.35));
  const highlightIdx = o.highlightId ? p.colors.findIndex((c) => c.id === o.highlightId) : -1;

  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      const idx = p.cells[y * p.width + x]!;
      const cx = x * cell + cell / 2;
      const cy = y * cell + cell / 2;
      if (idx < 0) {
        if (!asSquares) {
          ctx.fillStyle = o.pegColor ?? "#e4ded4";
          ctx.beginPath();
          ctx.arc(cx, cy, cell * 0.12, 0, Math.PI * 2);
          ctx.fill();
        }
        continue;
      }
      ctx.globalAlpha = highlightIdx >= 0 && idx !== highlightIdx ? 0.12 : 1;
      ctx.fillStyle = p.colors[idx]!.hex;
      if (asSquares) {
        ctx.fillRect(x * cell, y * cell, cell, cell);
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        // Faint rim so light beads don't read as empty pegs.
        ctx.strokeStyle = "rgba(0, 0, 0, 0.14)";
        ctx.lineWidth = Math.max(0.5, cell / 24);
        ctx.stroke();
        ctx.fillStyle = holeColors[idx]!;
        ctx.beginPath();
        ctx.arc(cx, cy, hole, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;

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

export function patternToCanvas(p: Pattern, o: DrawOptions): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = p.width * o.cell;
  canvas.height = p.height * o.cell;
  drawPattern(canvas.getContext("2d")!, p, o);
  return canvas;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportPng(p: Pattern, boardSize: number, showBoards: boolean, filename: string): void {
  const cell = Math.max(12, Math.min(32, Math.floor(4000 / Math.max(p.width, p.height))));
  patternToCanvas(p, { cell, boardSize, showBoards }).toBlob((blob) => blob && downloadBlob(blob, filename), "image/png");
}

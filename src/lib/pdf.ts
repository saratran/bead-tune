import { jsPDF } from "jspdf";
import { contrastText } from "./color";
import type { Pattern } from "./pattern";
import { patternToCanvas } from "./render";
import { symbolFor } from "./symbols";

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 14;

export function exportPdf(p: Pattern, brandName: string, boardSize: number, filename: string): void {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const boardsX = Math.ceil(p.width / boardSize);
  const boardsY = Math.ceil(p.height / boardSize);

  // Cover page: preview + shopping list.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Bead pattern", MARGIN, MARGIN + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(
    `${brandName} · ${p.width} × ${p.height} beads · ${p.total.toLocaleString()} beads · ${p.colors.length} colours · ${boardsX} × ${boardsY} boards of ${boardSize} × ${boardSize}`,
    MARGIN,
    MARGIN + 13,
  );

  const preview = patternToCanvas(p, { cell: 12, boardSize, showBoards: true });
  const maxW = PAGE_W - MARGIN * 2;
  const maxH = 120;
  const scale = Math.min(maxW / preview.width, maxH / preview.height);
  const pw = preview.width * scale;
  const ph = preview.height * scale;
  doc.addImage(preview.toDataURL("image/png"), "PNG", MARGIN + (maxW - pw) / 2, MARGIN + 20, pw, ph);

  let y = MARGIN + 20 + ph + 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Beads to buy", MARGIN, y);
  y += 6;
  doc.setFontSize(9);
  const colW = (PAGE_W - MARGIN * 2) / 2;
  const rowH = 6.5;
  p.colors.forEach((c, i) => {
    const col = i % 2;
    if (col === 0 && i > 0) y += rowH;
    if (y > PAGE_H - MARGIN) {
      doc.addPage();
      y = MARGIN + 4;
    }
    const x = MARGIN + col * colW;
    drawSwatch(doc, x, y - 4, 5, c.rgb, symbolFor(i));
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30);
    doc.text(c.code, x + 7, y);
    doc.setFont("helvetica", "normal");
    doc.text(c.name, x + 22, y);
    doc.text(p.counts[i]!.toLocaleString(), x + colW - 6, y, { align: "right" });
  });

  // One page per pegboard.
  const cell = Math.min((PAGE_W - MARGIN * 2 - 6) / boardSize, (PAGE_H - MARGIN * 2 - 20) / boardSize);
  for (let by = 0; by < boardsY; by++) {
    for (let bx = 0; bx < boardsX; bx++) {
      doc.addPage();
      doc.setTextColor(30);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text(`Board ${by * boardsX + bx + 1} of ${boardsX * boardsY}  —  row ${by + 1}, column ${bx + 1}`, MARGIN, MARGIN + 4);
      const ox = MARGIN + 6;
      const oy = MARGIN + 14;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.setTextColor(120);
      for (let i = 0; i < boardSize; i += 5) {
        doc.text(String(i + 1), ox + i * cell + cell / 2, oy - 1.5, { align: "center" });
        doc.text(String(i + 1), ox - 1.5, oy + i * cell + cell / 2 + 1, { align: "right" });
      }
      doc.setFontSize(Math.max(4, cell * 1.6));
      for (let yy = 0; yy < boardSize; yy++) {
        for (let xx = 0; xx < boardSize; xx++) {
          const px = bx * boardSize + xx;
          const py = by * boardSize + yy;
          const cx = ox + xx * cell;
          const cy = oy + yy * cell;
          const idx = px < p.width && py < p.height ? p.cells[py * p.width + px]! : -1;
          if (idx >= 0) {
            drawSwatch(doc, cx, cy, cell, p.colors[idx]!.rgb, symbolFor(idx));
          } else {
            doc.setDrawColor(225);
            doc.setLineWidth(0.1);
            doc.rect(cx, cy, cell, cell);
          }
        }
      }
      // Heavier lines every 5 beads for easier counting.
      doc.setDrawColor(90);
      doc.setLineWidth(0.3);
      for (let i = 0; i <= boardSize; i += 5) {
        doc.line(ox + i * cell, oy, ox + i * cell, oy + boardSize * cell);
        doc.line(ox, oy + i * cell, ox + boardSize * cell, oy + i * cell);
      }
      doc.rect(ox, oy, boardSize * cell, boardSize * cell);
    }
  }

  doc.save(filename);
}

function drawSwatch(doc: jsPDF, x: number, y: number, size: number, rgb: [number, number, number], symbol: string): void {
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  doc.setDrawColor(200);
  doc.setLineWidth(0.1);
  doc.rect(x, y, size, size, "FD");
  const text = contrastText(rgb);
  doc.setTextColor(text === "#ffffff" ? 255 : 30);
  const prev = doc.getFontSize();
  doc.setFontSize(size * 1.6);
  doc.text(symbol, x + size / 2, y + size * 0.72, { align: "center" });
  doc.setFontSize(prev);
  doc.setTextColor(30);
}

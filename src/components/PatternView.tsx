import { useEffect, useRef, useState } from "react";
import type { Pattern } from "../lib/pattern";
import { colorLabel } from "../lib/palettes";
import { drawPattern, type CellShape } from "../lib/render";

interface Props {
  pattern: Pattern;
  boardSize: number;
  showBoards: boolean;
  highlightId: string | null;
  onPickColor: (id: string | null) => void;
  theme: string;
  shape: CellShape;
  codes: boolean;
}

const MAX_CELL = 26;

export function PatternView({ pattern, boardSize, showBoards, highlightId, onPickColor, theme, shape, codes }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [wrapWidth, setWrapWidth] = useState(600);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setWrapWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cell = Math.max(2, Math.min(MAX_CELL, wrapWidth / pattern.width));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(pattern.width * cell * dpr);
    canvas.height = Math.round(pattern.height * cell * dpr);
    canvas.style.width = `${pattern.width * cell}px`;
    canvas.style.height = `${pattern.height * cell}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const token = (name: string) => css.getPropertyValue(name).trim() || undefined;
    drawPattern(ctx, pattern, {
      cell,
      shape,
      codes,
      boardSize,
      showBoards,
      highlightId,
      background: token("--board-bg"),
      pegColor: token("--peg"),
      boardLineColor: token("--board-line"),
    });
  }, [pattern, cell, shape, codes, boardSize, showBoards, highlightId, theme]);

  const cellAt = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / cell);
    const y = Math.floor((e.clientY - rect.top) / cell);
    return x >= 0 && y >= 0 && x < pattern.width && y < pattern.height ? { x, y } : null;
  };

  const hoverIdx = hover ? pattern.cells[hover.y * pattern.width + hover.x]! : -1;
  const hoverColor = hoverIdx >= 0 ? pattern.colors[hoverIdx] : undefined;

  return (
    <div className="pattern-view">
      <div className="pattern-scroll" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="pattern-canvas"
          onMouseMove={(e) => setHover(cellAt(e))}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            const c = cellAt(e);
            if (!c) return;
            const idx = pattern.cells[c.y * pattern.width + c.x]!;
            const id = idx >= 0 ? pattern.colors[idx]!.id : null;
            onPickColor(id === highlightId ? null : id);
          }}
        />
      </div>
      <div className="pattern-status">
        {hover ? (
          <>
            Column {hover.x + 1}, row {hover.y + 1}
            {hoverColor ? (
              <>
                {" · "}
                <span className="dot" style={{ background: hoverColor.hex }} />
                {colorLabel(hoverColor)}
              </>
            ) : (
              " · empty peg"
            )}
          </>
        ) : (
          "Tap a bead to highlight every bead of that colour."
        )}
      </div>
    </div>
  );
}

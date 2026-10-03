import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { beadsOn, boardsOf, leftOn, progressOf } from "../lib/build";
import { cropPattern } from "../lib/cleanup";
import type { Pattern } from "../lib/pattern";
import { colorLabel } from "../lib/palettes";
import { drawPattern } from "../lib/render";
import { canvasScale } from "./PatternView";
import { Toggle } from "./Toggle";

interface Props {
  pattern: Pattern;
  boardSize: number;
  title: string;
  /** Cell indices (in `pattern`) already placed. */
  placed: ReadonlySet<number>;
  onPlaced: (placed: Set<number>) => void;
  theme: string;
  onClose: () => void;
}

/**
 * Build mode: one pegboard at a time. Tap (or drag over) beads to mark them placed;
 * pick a colour to see only its beads. Progress is kept with the project.
 */
export function BuildMode({ pattern, boardSize, title, placed, onPlaced, theme, onClose }: Props) {
  const boards = useMemo(() => boardsOf(pattern, boardSize), [pattern, boardSize]);
  // Start on the first board that still needs beads.
  const [boardIdx, setBoardIdx] = useState(() => Math.max(0, boards.findIndex((b) => beadsOn(pattern, b).some((i) => !placed.has(i)))));
  const board = boards[Math.min(boardIdx, boards.length - 1)]!;
  const [colour, setColour] = useState<number | null>(null);
  const [codes, setCodes] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const boardPattern = useMemo(() => cropPattern(pattern, { x: board.x0, y: board.y0, w: board.w, h: board.h }), [pattern, board]);
  const left = useMemo(() => leftOn(pattern, board, placed), [pattern, board, placed]);
  const boardLeft = left.reduce((n, c) => n + c.left, 0);
  const { placed: done, total } = progressOf(pattern, placed);
  const pct = total ? Math.floor((100 * done) / total) : 0;
  const go = (d: number) => {
    setColour(null);
    setBoardIdx((i) => (i + d + boards.length) % boards.length);
  };

  // Fit the board to the space.
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [wrap, setWrap] = useState({ w: 600, h: 400 });
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (el.clientWidth > 0) setWrap({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(([e]) => e && setWrap({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const cell = Math.max(4, Math.min(60, Math.floor(Math.min(wrap.w / board.w, wrap.h / board.h))));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cssW = board.w * cell, cssH = board.h * cell;
    const scale = canvasScale(cssW, cssH, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * scale);
    canvas.height = Math.round(cssH * scale);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const token = (n: string) => css.getPropertyValue(n).trim() || undefined;
    drawPattern(ctx, boardPattern, {
      cell,
      shape: "bead",
      codes,
      boardSize,
      showBoards: false,
      highlightId: colour === null ? null : pattern.colors[colour]!.id,
      background: token("--board-bg"),
      pegColor: token("--peg"),
    });
    // Placed beads: dimmed, with a tick.
    const dim = token("--board-bg") ?? "#1a1822";
    for (let y = 0; y < board.h; y++) {
      for (let x = 0; x < board.w; x++) {
        const i = (board.y0 + y) * pattern.width + board.x0 + x;
        if (!placed.has(i) || pattern.cells[i]! < 0) continue;
        ctx.globalAlpha = 0.72;
        ctx.fillStyle = dim;
        ctx.fillRect(x * cell, y * cell, cell, cell);
        ctx.globalAlpha = 1;
        if (cell >= 10) {
          ctx.strokeStyle = "#7ad67a";
          ctx.lineWidth = Math.max(1.5, cell / 10);
          ctx.beginPath();
          ctx.moveTo(x * cell + cell * 0.28, y * cell + cell * 0.52);
          ctx.lineTo(x * cell + cell * 0.44, y * cell + cell * 0.68);
          ctx.lineTo(x * cell + cell * 0.74, y * cell + cell * 0.34);
          ctx.stroke();
        }
      }
    }
  }, [boardPattern, board, cell, codes, colour, placed, pattern, boardSize, theme]);

  // Tap toggles a bead; dragging sets every bead passed over the same way. With a colour
  // picked, only that colour's beads are touched.
  const drag = useRef<{ to: boolean; seen: Set<number> } | null>(null);
  const cellAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / cell), y = Math.floor((e.clientY - r.top) / cell);
    if (x < 0 || y < 0 || x >= board.w || y >= board.h) return null;
    const i = (board.y0 + y) * pattern.width + board.x0 + x;
    const c = pattern.cells[i]!;
    return c < 0 || (colour !== null && c !== colour) ? null : i;
  };
  const mark = (i: number, to: boolean) => {
    if (placed.has(i) === to) return;
    const next = new Set(placed);
    if (to) next.add(i);
    else next.delete(i);
    onPlaced(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("input, select, textarea")) return;
      let handled = true;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const boardDone = () => {
    const next = new Set(placed);
    for (const i of beadsOn(pattern, board)) next.add(i);
    onPlaced(next);
    setColour(null);
    if (boardIdx < boards.length - 1) setBoardIdx(boardIdx + 1);
  };

  return (
    <div className="build" role="dialog" aria-modal="true" aria-label="Build mode">
      <div className="build-bar">
        <button className="icon-btn" onClick={onClose} aria-label="Close build mode">
          ×
        </button>
        <div className="build-title">
          <strong>{title}</strong>
          <span className="muted small" data-testid="build-progress">
            {done.toLocaleString()} of {total.toLocaleString()} placed · {pct}%
          </span>
        </div>
        <progress className="build-meter" max={total} value={done} aria-label="Build progress" />
        <Toggle label="Codes" checked={codes} onChange={setCodes} />
        {confirmReset ? (
          <span className="row">
            <span className="small">Clear all progress?</span>
            <button
              className="btn btn-danger"
              onClick={() => {
                onPlaced(new Set());
                setConfirmReset(false);
                setBoardIdx(0);
              }}
            >
              Reset
            </button>
            <button className="btn btn-ghost" onClick={() => setConfirmReset(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button className="btn btn-ghost" disabled={done === 0} onClick={() => setConfirmReset(true)}>
            Reset
          </button>
        )}
      </div>
      <div className="build-body">
        <div className="build-board" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            className="build-canvas"
            onPointerDown={(e) => {
              const i = cellAt(e);
              if (i === null) return;
              e.currentTarget.setPointerCapture?.(e.pointerId);
              drag.current = { to: !placed.has(i), seen: new Set([i]) };
              mark(i, drag.current.to);
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              const i = cellAt(e);
              if (i === null || drag.current.seen.has(i)) return;
              drag.current.seen.add(i);
              mark(i, drag.current.to);
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
          />
        </div>
        <aside className="build-side">
          <div className="build-nav">
            <button className="icon-btn" onClick={() => go(-1)} aria-label="Previous board" disabled={boards.length < 2}>
              ‹
            </button>
            <div className="build-nav-label">
              <strong>
                Board {board.index + 1} of {boards.length}
              </strong>
              <span className="muted small">
                Row {board.by + 1}, column {board.bx + 1} · {boardLeft === 0 ? "done ✓" : `${boardLeft.toLocaleString()} left`}
              </span>
            </div>
            <button className="icon-btn" onClick={() => go(1)} aria-label="Next board" disabled={boards.length < 2}>
              ›
            </button>
          </div>
          <ul className="build-colours" aria-label="Colours on this board">
            {left.map(({ colour: c, left: n, total: t }) => {
              const bc = pattern.colors[c]!;
              return (
                <li key={bc.id}>
                  <button className={`build-colour ${colour === c ? "on" : ""} ${n === 0 ? "done" : ""}`} aria-pressed={colour === c} onClick={() => setColour(colour === c ? null : c)}>
                    <span className="swatch" style={{ background: bc.hex }} />
                    <span className="bead-name">{colorLabel(bc)}</span>
                    <span className="bead-count">{n === 0 ? "✓" : `${n} left`}</span>
                    <span className="sr-only"> of {t}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button className="btn btn-primary full" onClick={boardDone} disabled={boardLeft === 0}>
            ✓ Board done
          </button>
          <p className="hint">
            Tap a bead to mark it placed (drag to mark several). Pick a colour to see only its beads. ← → switch boards.
          </p>
        </aside>
      </div>
    </div>
  );
}

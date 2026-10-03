import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  /** Active edit tool; when set, pressing and dragging edits beads instead of highlighting. */
  tool?: EditTool | null;
  /** `mods`: Shift draws a straight line from the last bead; Alt picks a colour instead. */
  onEdit?: (index: number, phase: "start" | "move", mods?: { shift: boolean; alt: boolean }) => void;
  /** Paint/erase brush size in beads, or "fill" (for the outline under the cursor). */
  brushSize?: number | "fill";
  /**
   * Fullscreen viewer: fits the whole pattern, then `zoom` scales it (1 = fit).
   * Drag pans, pinch / Ctrl+wheel call `onZoom` with a scale factor.
   */
  fullscreen?: boolean;
  /** Fit-and-zoom like the fullscreen viewer, inside the page (the main workspace). */
  fit?: boolean;
  zoom?: number;
  onZoom?: (factor: number) => void;
}

export type EditTool = "paint" | "erase" | "replace" | "pick";

/** Tools that paint as you drag (the others act on a single click). */
const DRAG_TOOLS: EditTool[] = ["paint", "erase"];

const INLINE_MAX_CELL = 26;
const FULLSCREEN_MAX_CELL = 120;
// Browsers refuse very large canvases (iOS Safari: ~16.7M pixels); lower the backing resolution instead.
const MAX_CANVAS_SIDE = 8192;
const MAX_CANVAS_AREA = 16_000_000;
/** Movement (px) before a press counts as a pan rather than a click. */
const PAN_THRESHOLD = 4;

/** Backing-store scale for a canvas of `w` × `h` CSS pixels, within browser limits. */
export function canvasScale(w: number, h: number, dpr: number): number {
  return Math.max(0.1, Math.min(dpr, MAX_CANVAS_SIDE / w, MAX_CANVAS_SIDE / h, Math.sqrt(MAX_CANVAS_AREA / (w * h))));
}

export function PatternView({
  pattern,
  boardSize,
  showBoards,
  highlightId,
  onPickColor,
  theme,
  shape,
  codes,
  tool,
  onEdit,
  brushSize = 1,
  fullscreen: fullscreenProp = false,
  fit = false,
  zoom = 1,
  onZoom,
}: Props) {
  // Both the fullscreen viewer and the workspace fit the pattern to the box and zoom from there.
  const fullscreen = fullscreenProp || fit;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [wrap, setWrap] = useState({ w: 600, h: 400 });
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  // Cell index of the last edit in the current stroke, or null when not drawing.
  const stroke = useRef<number | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  // Centre of the view as a fraction of the content, so zooming keeps it in place.
  const centre = useRef({ x: 0.5, y: 0.5 });

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // Measure before the first paint so narrow screens never start from the default size.
    if (el.clientWidth > 0) setWrap({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(([entry]) => entry && setWrap({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cell = fullscreen
    ? Math.max(2, Math.min(FULLSCREEN_MAX_CELL, Math.min(wrap.w / pattern.width, wrap.h / pattern.height) * zoom))
    : Math.max(2, Math.min(INLINE_MAX_CELL, wrap.w / pattern.width));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cssW = pattern.width * cell;
    const cssH = pattern.height * cell;
    const scale = canvasScale(cssW, cssH, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * scale);
    canvas.height = Math.round(cssH * scale);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
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

  // Keep the same point in the middle of the view when the zoom changes.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!fullscreen || !el) return;
    el.scrollLeft = centre.current.x * el.scrollWidth - el.clientWidth / 2;
    el.scrollTop = centre.current.y * el.scrollHeight - el.clientHeight / 2;
  }, [cell, fullscreen]);

  // Ctrl/⌘ + wheel (and trackpad pinch, which browsers report the same way) zooms.
  useEffect(() => {
    const el = wrapRef.current;
    if (!fullscreen || !el || !onZoom) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      onZoom(Math.exp(-e.deltaY * 0.002));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [fullscreen, onZoom]);

  const cellAt = (e: { clientX: number; clientY: number; currentTarget: Element }) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / cell);
    const y = Math.floor((e.clientY - rect.top) / cell);
    return x >= 0 && y >= 0 && x < pattern.width && y < pattern.height ? { x, y } : null;
  };

  const pinchDistance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    stroke.current = null;
    if (pan.current?.moved) suppressClick.current = true;
    pan.current = null;
  };

  const hoverIdx = hover ? pattern.cells[hover.y * pattern.width + hover.x]! : -1;
  const hoverColor = hoverIdx >= 0 ? pattern.colors[hoverIdx] : undefined;

  return (
    <div className={`pattern-view ${fullscreen ? "is-fullscreen" : ""}`}>
      <div
        className="pattern-scroll"
        ref={wrapRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollWidth > 0 && el.scrollHeight > 0) {
            centre.current = {
              x: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth,
              y: (el.scrollTop + el.clientHeight / 2) / el.scrollHeight,
            };
          }
        }}
      >
        <div className="canvas-wrap">
        <canvas
          ref={canvasRef}
          className={`pattern-canvas ${tool ? `editing tool-${tool}` : ""} ${fullscreen && !tool ? "pannable" : ""}`}
          onMouseMove={(e) => setHover(cellAt(e))}
          onMouseLeave={() => setHover(null)}
          onPointerDown={(e) => {
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (fullscreen && pointers.current.size === 2) {
              // Second finger: switch to pinch-zoom and abandon any stroke or pan.
              stroke.current = null;
              pan.current = null;
              pinch.current = pinchDistance();
              return;
            }
            if (tool && onEdit) {
              const c = cellAt(e);
              if (!c) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture?.(e.pointerId);
              stroke.current = c.y * pattern.width + c.x;
              onEdit(stroke.current, "start", { shift: e.shiftKey, alt: e.altKey });
              if (e.altKey || !DRAG_TOOLS.includes(tool)) stroke.current = null;
              return;
            }
            if (fullscreen && wrapRef.current) {
              e.currentTarget.setPointerCapture?.(e.pointerId);
              pan.current = { x: e.clientX, y: e.clientY, left: wrapRef.current.scrollLeft, top: wrapRef.current.scrollTop, moved: false };
            }
          }}
          onPointerMove={(e) => {
            if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pinch.current !== null) {
              const d = pinchDistance();
              if (d > 0 && pinch.current > 0) onZoom?.(d / pinch.current);
              pinch.current = d;
              return;
            }
            if (pan.current && wrapRef.current) {
              const dx = e.clientX - pan.current.x;
              const dy = e.clientY - pan.current.y;
              if (Math.hypot(dx, dy) > PAN_THRESHOLD) pan.current.moved = true;
              wrapRef.current.scrollLeft = pan.current.left - dx;
              wrapRef.current.scrollTop = pan.current.top - dy;
              return;
            }
            if (stroke.current === null || !onEdit || !tool || !DRAG_TOOLS.includes(tool)) return;
            const c = cellAt(e);
            if (!c) return;
            const index = c.y * pattern.width + c.x;
            if (index === stroke.current) return;
            stroke.current = index;
            onEdit(index, "move");
          }}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onClick={(e) => {
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            if (tool) return;
            const c = cellAt(e);
            if (!c) return;
            const idx = pattern.cells[c.y * pattern.width + c.x]!;
            const id = idx >= 0 ? pattern.colors[idx]!.id : null;
            onPickColor(id === highlightId ? null : id);
          }}
        />
        {tool && hover && (() => {
          // Outline of the beads the next click will change.
          const size = DRAG_TOOLS.includes(tool) && typeof brushSize === "number" ? brushSize : 1;
          const x0 = Math.max(0, hover.x - Math.floor((size - 1) / 2));
          const y0 = Math.max(0, hover.y - Math.floor((size - 1) / 2));
          const x1 = Math.min(pattern.width, hover.x - Math.floor((size - 1) / 2) + size);
          const y1 = Math.min(pattern.height, hover.y - Math.floor((size - 1) / 2) + size);
          return <div className="brush-preview" style={{ left: x0 * cell, top: y0 * cell, width: (x1 - x0) * cell, height: (y1 - y0) * cell }} />;
        })()}
        </div>
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
        ) : tool ? (
          {
            paint:
              brushSize === "fill"
                ? "Click to fill a connected area of one colour · Alt-click picks a colour."
                : "Click or drag to paint · Shift-click draws a line · Alt-click picks a colour.",
            erase: brushSize === "fill" ? "Click to clear a connected area of one colour." : "Click or drag to remove beads · Shift-click erases a line.",
            replace: "Click a colour to replace every bead of it.",
            pick: "Click a bead to use its colour.",
          }[tool]
        ) : fullscreen ? (
          "Drag to move around · pinch or Ctrl+scroll to zoom · tap a bead to highlight its colour."
        ) : (
          "Tap a bead to highlight every bead of that colour."
        )}
      </div>
    </div>
  );
}

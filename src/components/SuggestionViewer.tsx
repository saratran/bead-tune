import { useCallback, useEffect, useState } from "react";
import { TONE_LABEL, type Tone } from "../lib/auto";
import type { Pattern } from "../lib/pattern";
import type { Crop } from "../lib/sampling";
import { OriginalView } from "./OriginalView";
import { PatternView } from "./PatternView";
import { Toggle } from "./Toggle";

/** One result to show large: a suggestion, or a bookmark rebuilt into a pattern. */
export interface ViewerItem {
  key: string;
  label: string;
  tone?: Tone;
  pattern: Pattern;
  scores: { features?: number; likeness: number; ease: number };
  settings: string;
  bookmarked: boolean;
}

interface Props {
  items: ViewerItem[];
  index: number;
  onIndex: (i: number) => void;
  onApply: (item: ViewerItem) => void;
  onToggleBookmark?: (item: ViewerItem) => void;
  onClose: () => void;
  /** For the side-by-side comparison. */
  image?: HTMLImageElement | null;
  crop?: Crop;
  boardSize: number;
  theme: string;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const STEP = 1.25;

export function SuggestionViewer({ items, index, onIndex, onApply, onToggleBookmark, onClose, image, crop, boardSize, theme }: Props) {
  const item = items[index]!;
  const [zoom, setZoom] = useState(1);
  const [codes, setCodes] = useState(false);
  const [compare, setCompare] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const zoomBy = useCallback((f: number) => setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * f))), []);
  const go = useCallback((d: number) => onIndex((index + d + items.length) % items.length), [index, items.length, onIndex]);

  // A new result starts fitted, with nothing highlighted.
  useEffect(() => {
    setZoom(1);
    setHighlightId(null);
  }, [item.key]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("input, textarea, select")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      let handled = true;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "+" || e.key === "=") zoomBy(STEP);
      else if (e.key === "-" || e.key === "_") zoomBy(1 / STEP);
      else if (e.key === "0") setZoom(1);
      else handled = false;
      if (handled) {
        e.preventDefault();
        // Keep the Auto panel's own Esc handler from closing the whole panel.
        e.stopImmediatePropagation();
      }
    };
    // Capture phase so this runs before the panel's listener.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, go, zoomBy]);

  const p = item.pattern;
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={`View ${item.label}`}>
      <div className="viewer-bar">
        <div className="viewer-title">
          <strong>{item.label}</strong>
          {item.tone && item.tone !== "natural" && <span className={`badge tone tone-${item.tone}`}>{TONE_LABEL[item.tone]}</span>}
          <span className="muted small">
            {p.width} × {p.height} · {p.colors.length} colours · {p.total.toLocaleString()} beads
          </span>
          <span className="small viewer-scores">
            {item.scores.features !== undefined && <>Features {item.scores.features} · </>}Likeness {item.scores.likeness} · Ease {item.scores.ease}
          </span>
        </div>
        <div className="actions">
          {items.length > 1 && (
            <div className="zoom" role="group" aria-label="Browse results">
              <button className="btn btn-ghost" onClick={() => go(-1)} aria-label="Previous result">
                ‹
              </button>
              <span className="zoom-level">
                {index + 1} / {items.length}
              </span>
              <button className="btn btn-ghost" onClick={() => go(1)} aria-label="Next result">
                ›
              </button>
            </div>
          )}
          <div className="zoom" role="group" aria-label="Zoom">
            <button className="btn btn-ghost" onClick={() => zoomBy(1 / STEP)} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out">
              −
            </button>
            <span className="zoom-level">{Math.round(zoom * 100)}%</span>
            <button className="btn btn-ghost" onClick={() => zoomBy(STEP)} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in">
              +
            </button>
            <button className="btn btn-ghost" onClick={() => setZoom(1)} disabled={zoom === 1}>
              Fit
            </button>
          </div>
          <Toggle label="Codes" checked={codes} onChange={setCodes} />
          {image && <Toggle label="Original" checked={compare} onChange={setCompare} />}
          {onToggleBookmark && (
            <button
              className={`star-btn ${item.bookmarked ? "on" : ""}`}
              aria-pressed={item.bookmarked}
              aria-label={item.bookmarked ? `Remove bookmark: ${item.label}` : `Bookmark ${item.label}`}
              onClick={() => onToggleBookmark(item)}
            >
              {item.bookmarked ? "★" : "☆"}
            </button>
          )}
          <button className="btn btn-primary" onClick={() => onApply(item)}>
            Use this
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="Close viewer">
            ×
          </button>
        </div>
      </div>
      <div className={`fs-body ${compare && image ? "with-original" : ""}`}>
        {compare && image && <OriginalView image={image} crop={crop ?? { x: 0, y: 0, w: 1, h: 1 }} onHide={() => setCompare(false)} />}
        <PatternView
          pattern={p}
          boardSize={boardSize}
          showBoards={false}
          highlightId={highlightId}
          onPickColor={setHighlightId}
          theme={theme}
          shape="square"
          codes={codes}
          fullscreen
          zoom={zoom}
          onZoom={zoomBy}
        />
      </div>
    </div>
  );
}

import { BRUSH_SIZES, type BrushSize } from "../lib/editing";
import { colorLabel, type BeadColor } from "../lib/palettes";
import type { CellShape } from "../lib/render";
import type { EditTool } from "./PatternView";
import { ShapePicker } from "./ShapePicker";
import { Toggle } from "./Toggle";

export interface DisplaySettings {
  shape: CellShape;
  codes: boolean;
  /** Show the original image next to the pattern. */
  original: boolean;
}

/** Cell shape, colour codes and board lines. */
export function DisplayControls({
  display,
  onDisplay,
  showBoards,
  onShowBoards,
  canShowOriginal = true,
}: {
  display: DisplaySettings;
  onDisplay: (d: DisplaySettings) => void;
  showBoards: boolean;
  onShowBoards: (v: boolean) => void;
  canShowOriginal?: boolean;
}) {
  return (
    <>
      <ShapePicker value={display.shape} onChange={(shape) => onDisplay({ ...display, shape })} />
      <Toggle label="Codes" checked={display.codes} onChange={(codes) => onDisplay({ ...display, codes })} />
      <Toggle label="Board lines" checked={showBoards} onChange={onShowBoards} />
      {canShowOriginal && <Toggle label="Original" checked={display.original} onChange={(original) => onDisplay({ ...display, original })} />}
    </>
  );
}

const TOOL_LABELS: Record<EditTool, string> = { paint: "Paint", erase: "Erase", replace: "Replace", pick: "Pick colour" };

/** Keyboard shortcut for each tool (shown on hover; handled in the app). */
export const TOOL_KEYS: Record<EditTool, string> = { paint: "B", erase: "E", replace: "R", pick: "I" };

const TOOL_HINTS: Record<EditTool, string> = {
  paint: "Paint beads with the brush colour",
  erase: "Remove beads",
  replace: "Replace every bead of a colour",
  pick: "Pick a colour from the pattern (or Alt-click with any tool)",
};

/** Small line icons (16 × 16, currentColor). */
const ICON_PATHS: Record<EditTool | "fill", string> = {
  // Brush: handle and bristles.
  paint: "M11 2.5 13.5 5 7.5 11 5 8.5ZM4.3 9.6l2.1 2.1c-.4 1.6-1.7 2.3-3.9 2.3.1-2.1.7-3.4 1.8-4.4Z",
  // Eraser: tilted block on a baseline.
  erase: "M9.6 2.8 13.2 6.4 7.6 12H4.7L2.8 10.1ZM6.2 6.2l3.6 3.6M7.6 12H13.5",
  // Replace: two arrows swapping.
  replace: "M3 5.5h8.5m-2.5-2.5 2.5 2.5L9 8M13 10.5H4.5m2.5 2.5-2.5-2.5L7 8",
  // Eyedropper.
  pick: "M10.4 2.6a1.9 1.9 0 0 1 2.7 2.7l-1.4 1.4.7.7-1 1-3.8-3.8 1-1 .7.7ZM8.6 6.4 4 11v1.9h1.9l4.6-4.6",
  // Paint bucket with a drip.
  fill: "M7.6 2.5 12.8 7.7 8 12.5 2.8 7.3ZM2.8 7.3h10M13.5 10.2c.7 1 1 1.6 1 2.1a1 1 0 0 1-2 0c0-.5.3-1.1 1-2.1Z",
};

export function ToolIcon({ name }: { name: EditTool | "fill" }) {
  return (
    <svg className="tool-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

/** Paint / erase / fill / replace / pick, brush colour and size, undo/redo and clear. */
export function EditBar({
  tool,
  onTool,
  brush,
  onChooseBrush,
  brushSize = 1,
  onBrushSize,
  canUndo,
  onUndo,
  canRedo = false,
  onRedo,
  canClear,
  onClear,
  outline,
}: {
  tool: EditTool;
  onTool: (t: EditTool) => void;
  brush: BeadColor | null;
  onChooseBrush: () => void;
  brushSize?: BrushSize;
  onBrushSize?: (size: BrushSize) => void;
  canUndo: boolean;
  onUndo: () => void;
  canRedo?: boolean;
  onRedo?: () => void;
  canClear: boolean;
  onClear: () => void;
  /**
   * Adds a one-bead outline round the current shape as ordinary hand edits.
   * `margin` adds an empty ring round the pattern so the outline fits.
   */
  outline?: { color: BeadColor; onAdd: () => void; onChooseColor: () => void; margin: boolean; onMargin: (on: boolean) => void };
}) {
  return (
    <div className="edit-bar">
      <div className="segmented" role="radiogroup" aria-label="Edit tool">
        {(["paint", "erase", "replace", "pick"] as const).map((t) => (
          <button key={t} role="radio" aria-checked={tool === t} className={`with-icon ${tool === t ? "on" : ""}`} onClick={() => onTool(t)} title={`${TOOL_HINTS[t]} (${TOOL_KEYS[t]})`}>
            <ToolIcon name={t} />
            {TOOL_LABELS[t]}
          </button>
        ))}
      </div>
      <button className="btn btn-ghost row" onClick={onChooseBrush} title="Brush colour">
        <span className="dot big" style={{ background: brush?.hex }} />
        {brush ? colorLabel(brush) : "Colour"}
      </button>
      {onBrushSize && (tool === "paint" || tool === "erase") && (
        <div className="segmented brush-size" role="radiogroup" aria-label="Brush size" title="Brush size ([ and ] to change)">
          {BRUSH_SIZES.map((n) =>
            n === "fill" ? (
              <button
                key={n}
                role="radio"
                aria-checked={brushSize === n}
                className={`with-icon ${brushSize === n ? "on" : ""}`}
                onClick={() => onBrushSize(n)}
                title={`${tool === "erase" ? "Clear" : "Fill"} a connected area of one colour (G)`}
              >
                <ToolIcon name="fill" />
                Fill
              </button>
            ) : (
              <button key={n} role="radio" aria-checked={brushSize === n} className={brushSize === n ? "on" : ""} onClick={() => onBrushSize(n)}>
                {n}
              </button>
            ),
          )}
        </div>
      )}
      <button className="btn btn-ghost" disabled={!canUndo} onClick={onUndo} title="Undo (⌘/Ctrl+Z)">
        Undo
      </button>
      {onRedo && (
        <button className="btn btn-ghost" disabled={!canRedo} onClick={onRedo} title="Redo (⌘/Ctrl+Shift+Z)">
          Redo
        </button>
      )}
      <button className="btn btn-ghost" disabled={!canClear} onClick={onClear}>
        Clear edits
      </button>
      {outline && (
        <span className="edit-outline">
          <button className="btn btn-ghost" onClick={outline.onAdd} title="Add a one-bead outline round the shape as it is now (click again for a thicker one)">
            Add outline
          </button>
          <button className="btn btn-ghost row" onClick={outline.onChooseColor} title="Outline colour" aria-label="Outline colour">
            <span className="dot big" style={{ background: outline.color.hex }} />
            {outline.color.code}
          </button>
          <span title="Add an empty ring of beads round the pattern (2 beads wider and taller) so the outline isn't cut off. Your edits stay put.">
            <Toggle label="Edge margin" checked={outline.margin} onChange={outline.onMargin} />
          </span>
        </span>
      )}
      <details className="shortcuts">
        <summary>Shortcuts</summary>
        <p className="hint">
          B paint · E erase · R replace · I pick · G fill size · [ ] brush size · Shift-click line · Alt-click pick · ⌘/Ctrl+Z undo · ⌘/Ctrl+Shift+Z redo · Esc done
        </p>
      </details>
    </div>
  );
}

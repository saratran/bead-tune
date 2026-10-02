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

const TOOL_LABELS: Record<EditTool, string> = { paint: "Paint", erase: "Erase", pick: "Pick colour" };

/** Paint / erase / pick, brush colour, undo and clear. */
export function EditBar({
  tool,
  onTool,
  brush,
  onChooseBrush,
  canUndo,
  onUndo,
  canClear,
  onClear,
  outline,
}: {
  tool: EditTool;
  onTool: (t: EditTool) => void;
  brush: BeadColor | null;
  onChooseBrush: () => void;
  canUndo: boolean;
  onUndo: () => void;
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
        {(["paint", "erase", "pick"] as const).map((t) => (
          <button key={t} role="radio" aria-checked={tool === t} className={tool === t ? "on" : ""} onClick={() => onTool(t)}>
            {TOOL_LABELS[t]}
          </button>
        ))}
      </div>
      <button className="btn btn-ghost row" onClick={onChooseBrush} title="Brush colour">
        <span className="dot big" style={{ background: brush?.hex }} />
        {brush ? colorLabel(brush) : "Colour"}
      </button>
      <button className="btn btn-ghost" disabled={!canUndo} onClick={onUndo}>
        Undo
      </button>
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
    </div>
  );
}

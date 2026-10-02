import { colorLabel, type BeadColor } from "../lib/palettes";
import type { CellShape } from "../lib/render";
import type { EditTool } from "./PatternView";
import { ShapePicker } from "./ShapePicker";
import { Toggle } from "./Toggle";

export interface DisplaySettings {
  shape: CellShape;
  codes: boolean;
}

/** Cell shape, colour codes and board lines. */
export function DisplayControls({
  display,
  onDisplay,
  showBoards,
  onShowBoards,
}: {
  display: DisplaySettings;
  onDisplay: (d: DisplaySettings) => void;
  showBoards: boolean;
  onShowBoards: (v: boolean) => void;
}) {
  return (
    <>
      <ShapePicker value={display.shape} onChange={(shape) => onDisplay({ ...display, shape })} />
      <Toggle label="Codes" checked={display.codes} onChange={(codes) => onDisplay({ ...display, codes })} />
      <Toggle label="Board lines" checked={showBoards} onChange={onShowBoards} />
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
}: {
  tool: EditTool;
  onTool: (t: EditTool) => void;
  brush: BeadColor | null;
  onChooseBrush: () => void;
  canUndo: boolean;
  onUndo: () => void;
  canClear: boolean;
  onClear: () => void;
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
    </div>
  );
}

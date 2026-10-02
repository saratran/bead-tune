import { CELL_SHAPES, type CellShape } from "../lib/render";

const LABELS: Record<CellShape, string> = {
  square: "Square",
  bead: "Bead",
  cross: "Cross",
  circle: "Dot",
};

function ShapeIcon({ shape }: { shape: CellShape }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
      {shape === "square" && <rect x="2" y="2" width="12" height="12" fill="currentColor" />}
      {shape === "bead" && <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="3.4" />}
      {shape === "cross" && <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />}
      {shape === "circle" && <circle cx="8" cy="8" r="6.5" fill="currentColor" />}
    </svg>
  );
}

export function ShapePicker({ value, onChange }: { value: CellShape; onChange: (s: CellShape) => void }) {
  return (
    <div className="segmented icons" role="radiogroup" aria-label="Cell shape">
      {CELL_SHAPES.map((s) => (
        <button key={s} role="radio" aria-checked={value === s} className={value === s ? "on" : ""} title={LABELS[s]} onClick={() => onChange(s)}>
          <ShapeIcon shape={s} />
          <span className="sr-only">{LABELS[s]}</span>
        </button>
      ))}
    </div>
  );
}

import type { Pattern } from "../lib/pattern";
import type { BeadColor } from "../lib/palettes";

interface Props {
  pattern: Pattern | null;
  highlightId: string | null;
  onHighlight: (id: string | null) => void;
  onSwap: (c: BeadColor) => void;
  onRemove: (c: BeadColor) => void;
  canRemove: boolean;
}

export function BeadList({ pattern, highlightId, onHighlight, onSwap, onRemove, canRemove }: Props) {
  const total = pattern?.total ?? 0;
  const count = pattern?.colors.length ?? 0;
  return (
    <section className="bead-list" aria-label="Beads to buy">
      <div className="panel-head">
        <h2>Beads to buy</h2>
        <span className="pill">
          {total.toLocaleString()} beads · {count} colour{count === 1 ? "" : "s"}
        </span>
      </div>
      {!pattern || count === 0 ? (
        <p className="muted small">Add an image and your shopping list shows up here.</p>
      ) : (
        <>
          <p className="muted small">Click a colour to find it on the pattern. ⇄ swaps it, × removes it.</p>
          <ul>
            {pattern.colors.map((c, i) => (
              <li key={c.id} className={highlightId === c.id ? "active" : ""}>
                <button className="bead-row" onClick={() => onHighlight(highlightId === c.id ? null : c.id)}>
                  <span className="swatch" style={{ background: c.hex }} />
                  <span className="bead-name">
                    <b>{c.code}</b>{c.name && ` ${c.name}`}
                  </span>
                  <span className="bead-count">{pattern.counts[i]!.toLocaleString()}</span>
                </button>
                <button className="icon-btn" title="Swap for another colour" onClick={() => onSwap(c)}>
                  ⇄
                </button>
                <button
                  className="icon-btn"
                  title="Remove colour (beads move to the nearest remaining colour)"
                  disabled={!canRemove}
                  onClick={() => onRemove(c)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

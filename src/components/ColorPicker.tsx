import { useEffect, useMemo, useState } from "react";
import { deltaE2000 } from "../lib/color";
import { colorLabel, type BeadColor } from "../lib/palettes";

interface BaseProps {
  title: string;
  colors: BeadColor[];
  onClose: () => void;
}

type Props =
  | (BaseProps & {
      mode: "single";
      current?: string;
      onPick: (c: BeadColor) => void;
      /** Offer colours closest to this one first (e.g. when swapping it). */
      nearTo?: BeadColor;
      /** Colours already in the pattern, marked in the grid. */
      inUse?: ReadonlySet<string>;
    })
  | (BaseProps & { mode: "multi"; selected: Set<string>; onChange: (s: Set<string>) => void });

export function ColorPicker(props: Props) {
  const [query, setQuery] = useState("");
  const { colors, onClose, title } = props;
  const nearTo = props.mode === "single" ? props.nearTo : undefined;
  const inUse = props.mode === "single" ? props.inUse : undefined;
  const [order, setOrder] = useState<"closest" | "code">("closest");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matching = q ? colors.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)) : colors;
    if (!nearTo || order === "code") return matching;
    // Closest by eye (CIEDE2000) first; the colour itself leads.
    return [...matching].sort((a, b) => deltaE2000(nearTo.lab, a.lab) - deltaE2000(nearTo.lab, b.lab));
  }, [colors, query, nearTo, order]);

  const isOn = (c: BeadColor) => (props.mode === "multi" ? props.selected.has(c.id) : props.current === c.id);

  const toggle = (c: BeadColor) => {
    if (props.mode === "single") {
      props.onPick(c);
      return;
    }
    const next = new Set(props.selected);
    if (next.has(c.id)) next.delete(c.id);
    else next.add(c.id);
    props.onChange(next);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-tools">
          <input
            className="input"
            placeholder="Search by name or code"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {nearTo && (
            <div className="segmented" role="radiogroup" aria-label="Order">
              {(
                [
                  ["closest", "Closest first"],
                  ["code", "By code"],
                ] as const
              ).map(([v, label]) => (
                <button key={v} role="radio" aria-checked={order === v} className={order === v ? "on" : ""} onClick={() => setOrder(v)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          {props.mode === "multi" && (
            <>
              <button className="btn btn-ghost" onClick={() => props.onChange(new Set(colors.map((c) => c.id)))}>
                All
              </button>
              <button className="btn btn-ghost" onClick={() => props.onChange(new Set())}>
                None
              </button>
            </>
          )}
        </div>
        <div className="swatch-grid">
          {shown.map((c) => (
            <button key={c.id} className={`swatch-btn ${isOn(c) ? "on" : ""}`} onClick={() => toggle(c)} title={colorLabel(c)}>
              <span className="swatch" style={{ background: c.hex }} />
              <span className="swatch-label">
                <b>{c.code}</b>{c.name && ` ${c.name}`}
              </span>
              {inUse?.has(c.id) && !(props.mode === "single" && c.id === props.current) && (
                <span className="in-use" title="Already in the pattern">
                  in use
                </span>
              )}
            </button>
          ))}
          {shown.length === 0 && <p className="muted">No colours match “{query}”.</p>}
        </div>
        {props.mode === "multi" && (
          <div className="modal-foot">
            <span className="muted">{props.selected.size} selected</span>
            <button className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useRef } from "react";

interface Props {
  id?: string;
  /** Used for the buttons' accessible names ("Decrease …" / "Increase …"). */
  label: string;
  value: number;
  min: number;
  max: number;
  /** Amount each button press (or repeat) changes the value. */
  step?: number;
  onChange: (value: number) => void;
}

const REPEAT_DELAY = 400;
const REPEAT_EVERY = 70;

/** A range slider with − / + buttons; holding a button keeps stepping. */
export function RangeInput({ id, label, value, min, max, step = 1, onChange }: Props) {
  // Refs so a held button keeps stepping from the latest value.
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const timers = useRef<{ delay?: ReturnType<typeof setTimeout>; repeat?: ReturnType<typeof setInterval> }>({});

  const stop = () => {
    clearTimeout(timers.current.delay);
    clearInterval(timers.current.repeat);
    timers.current = {};
  };
  useEffect(() => stop, []);

  const bump = (dir: 1 | -1) => {
    const next = Math.min(max, Math.max(min, valueRef.current + dir * step));
    if (next === valueRef.current) {
      stop(); // reached the end
      return;
    }
    valueRef.current = next;
    onChangeRef.current(next);
  };

  const button = (dir: 1 | -1) => ({
    type: "button" as const,
    className: "step-btn",
    "aria-label": `${dir < 0 ? "Decrease" : "Increase"} ${label}`,
    disabled: dir < 0 ? value <= min : value >= max,
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      bump(dir);
      stop();
      timers.current.delay = setTimeout(() => {
        timers.current.repeat = setInterval(() => bump(dir), REPEAT_EVERY);
      }, REPEAT_DELAY);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    // Keyboard activation (Enter/Space) has no pointer events; clicks from a pointer were handled above.
    onClick: (e: React.MouseEvent) => {
      if (e.detail === 0) bump(dir);
    },
  });

  return (
    <div className="range-input">
      <button {...button(-1)}>−</button>
      <input id={id} type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <button {...button(1)}>+</button>
    </div>
  );
}

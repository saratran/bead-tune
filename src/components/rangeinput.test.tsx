import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { DEFAULT_IMAGE_SETTINGS, ImageOptions, type ImageSettings } from "./ImageOptions";
import { RangeInput } from "./RangeInput";
import { mard } from "../test/fixtures";

function Harness({ initial = 5, min = 0, max = 10, step = 1, onValue }: { initial?: number; min?: number; max?: number; step?: number; onValue?: (v: number) => void }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <RangeInput
        id="r"
        label="Size"
        value={v}
        min={min}
        max={max}
        step={step}
        onChange={(n) => {
          setV(n);
          onValue?.(n);
        }}
      />
      <output data-testid="value">{v}</output>
    </>
  );
}

const value = () => Number(screen.getByTestId("value").textContent);
const tap = (el: HTMLElement) => {
  fireEvent.pointerDown(el, { button: 0, pointerId: 1 });
  fireEvent.pointerUp(el, { button: 0, pointerId: 1 });
  fireEvent.click(el, { detail: 1 }); // the click that follows a pointer tap must not count twice
};

describe("RangeInput", () => {
  test("− and + step the value once per tap", () => {
    render(<Harness />);
    tap(screen.getByLabelText("Increase Size"));
    expect(value()).toBe(6);
    tap(screen.getByLabelText("Decrease Size"));
    tap(screen.getByLabelText("Decrease Size"));
    expect(value()).toBe(4);
  });

  test("keyboard activation works too", () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText("Increase Size"), { detail: 0 });
    expect(value()).toBe(6);
  });

  test("uses the step size", () => {
    render(<Harness initial={0} min={-100} max={100} step={5} />);
    tap(screen.getByLabelText("Increase Size"));
    expect(value()).toBe(5);
  });

  test("stays within range and disables the button at each end", () => {
    render(<Harness initial={9} />);
    const plus = screen.getByLabelText("Increase Size") as HTMLButtonElement;
    tap(plus);
    expect(value()).toBe(10);
    expect(plus.disabled).toBe(true);
    render(<Harness initial={0} />);
    expect((screen.getAllByLabelText("Decrease Size")[1] as HTMLButtonElement).disabled).toBe(true);
  });

  test("never steps past the end with an uneven step", () => {
    render(<Harness initial={8} step={5} />);
    tap(screen.getByLabelText("Increase Size"));
    expect(value()).toBe(10);
  });

  test("holding a button keeps stepping until released", async () => {
    render(<Harness initial={0} max={100} />);
    const plus = screen.getByLabelText("Increase Size");
    fireEvent.pointerDown(plus, { button: 0, pointerId: 1 });
    await waitFor(() => expect(value()).toBeGreaterThanOrEqual(4), { timeout: 1500 });
    fireEvent.pointerUp(plus, { button: 0, pointerId: 1 });
    const stoppedAt = value();
    await new Promise((r) => setTimeout(r, 250));
    expect(value()).toBe(stoppedAt);
  });

  test("holding stops at the end of the range", async () => {
    const onValue = mock();
    render(<Harness initial={7} onValue={onValue} />);
    fireEvent.pointerDown(screen.getByLabelText("Increase Size"), { button: 0, pointerId: 1 });
    await waitFor(() => expect(value()).toBe(10), { timeout: 1500 });
    await new Promise((r) => setTimeout(r, 200));
    expect(onValue.mock.calls.map((c) => c[0])).toEqual([8, 9, 10]);
  });

  test("the slider itself still works", () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "2" } });
    expect(value()).toBe(2);
  });
});

describe("image option sliders have steppers", () => {
  function Options() {
    const [s, setS] = useState<ImageSettings>({ ...DEFAULT_IMAGE_SETTINGS, removeBackground: true, dither: "ordered" });
    return (
      <>
        <ImageOptions settings={s} onChange={setS} result={null} outlineColor={mard[0]!} onChooseOutline={() => {}} pickingBackground={false} onPickBackground={() => {}} />
        <pre data-testid="state">{JSON.stringify(s)}</pre>
      </>
    );
  }
  const state = () => JSON.parse(screen.getByTestId("state").textContent!) as ImageSettings;

  test("every slider has − and + buttons", () => {
    render(<Options />);
    for (const name of ["Brightness", "Contrast", "Saturation", "Tolerance", "Colours", "Min beads per colour", "Dither strength", "Remove stray beads"]) {
      expect(screen.getByLabelText(`Decrease ${name}`)).toBeTruthy();
      expect(screen.getByLabelText(`Increase ${name}`)).toBeTruthy();
    }
  });

  test("every slider steps by 1", () => {
    render(<Options />);
    tap(screen.getByLabelText("Increase Brightness"));
    tap(screen.getByLabelText("Decrease Contrast"));
    tap(screen.getByLabelText("Increase Colours"));
    tap(screen.getByLabelText("Decrease Tolerance"));
    expect(state().adjustments).toMatchObject({ brightness: 1, contrast: -1 });
    expect(state()).toMatchObject({ maxColors: 25, bgTolerance: 13 });
    expect(screen.getByText("+1")).toBeTruthy();
  });

  test("the adjustment sliders are labelled for assistive tech", () => {
    render(<Options />);
    expect(screen.getByRole("slider", { name: "Brightness" })).toBeTruthy();
  });
});

import { describe, expect, mock, test } from "bun:test";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { App } from "../App";
import { mockPixels } from "../test/canvas-mock";
import { makePattern, mard } from "../test/fixtures";
import { DEFAULT_IMAGE_SETTINGS, ImageOptions, type ImageSettings } from "./ImageOptions";
import { PatternView } from "./PatternView";

describe("ImageOptions", () => {
  function Harness(props: { initial?: Partial<ImageSettings>; onChooseOutline?: () => void; result?: Parameters<typeof ImageOptions>[0]["result"] }) {
    const [s, setS] = useState<ImageSettings>({ ...DEFAULT_IMAGE_SETTINGS, ...props.initial });
    const [picking, setPicking] = useState(false);
    return (
      <>
        <ImageOptions
          settings={s}
          onChange={setS}
          result={props.result ?? null}
          outlineColor={mard[0]!}
          onChooseOutline={props.onChooseOutline ?? (() => {})}
          pickingBackground={picking}
          onPickBackground={setPicking}
        />
        <pre data-testid="state">{JSON.stringify(s)}</pre>
      </>
    );
  }
  const state = () => JSON.parse(screen.getByTestId("state").textContent!) as ImageSettings;

  test("defaults: smooth sampling, no dithering, cleanup and outline off", () => {
    render(<Harness />);
    expect(screen.getByRole("radio", { name: "Smooth" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Off" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Standard" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("slider", { name: /Remove stray beads/ }).closest(".field")!.textContent).toContain("off");
    expect(screen.getByRole("slider", { name: /Min beads per colour/ }).closest(".field")!.textContent).toContain("off");
  });

  test("sampling, matching and dithering choices update settings", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "Sharp" }));
    fireEvent.click(screen.getByRole("radio", { name: "Accurate" }));
    fireEvent.click(screen.getByRole("radio", { name: "Ordered" }));
    expect(state()).toMatchObject({ sampling: "sharp", metric: "accurate", dither: "ordered" });
  });

  test("dither strength only shows while dithering", () => {
    render(<Harness />);
    expect(screen.queryByRole("slider", { name: /Dither strength/ })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Diffusion" }));
    fireEvent.change(screen.getByRole("slider", { name: /Dither strength/ }), { target: { value: "40" } });
    expect(state().ditherStrength).toBe(40);
  });

  test("background tolerance and colour only show when removing the background", () => {
    render(<Harness />);
    expect(screen.queryByRole("slider", { name: /Tolerance/ })).toBeNull();
    fireEvent.click(screen.getByLabelText("Remove background"));
    fireEvent.change(screen.getByRole("slider", { name: /Tolerance/ }), { target: { value: "30" } });
    expect(state()).toMatchObject({ removeBackground: true, bgTolerance: 30 });
    fireEvent.click(screen.getByText("Pick from image"));
    expect(screen.getByText("Click the image…")).toBeTruthy();
  });

  test("a picked background colour shows and can be reset to auto", () => {
    render(<Harness initial={{ removeBackground: true, bgColor: [10, 200, 30] }} />);
    expect(screen.getByTitle("#0ac81e")).toBeTruthy();
    fireEvent.click(screen.getByText("Auto"));
    expect(state().bgColor).toBeNull();
  });

  test("cleanup slider describes the group size", () => {
    render(<Harness />);
    const slider = screen.getByRole("slider", { name: /Remove stray beads/ });
    fireEvent.change(slider, { target: { value: "1" } });
    expect(slider.closest(".field")!.textContent).toContain("single beads");
    fireEvent.change(slider, { target: { value: "3" } });
    expect(slider.closest(".field")!.textContent).toContain("groups up to 3");
    expect(state().cleanup).toBe(3);
  });

  test("outline colour button appears when outline is on", () => {
    const choose = mock();
    render(<Harness onChooseOutline={choose} />);
    expect(screen.queryByTitle("Outline colour")).toBeNull();
    fireEvent.click(screen.getByLabelText("Outline"));
    fireEvent.click(screen.getByTitle("Outline colour"));
    expect(choose).toHaveBeenCalled();
    expect(screen.getByText(/Outlines need empty space/)).toBeTruthy();
  });

  test("pixel art mode reports the detected grid or the fallback", () => {
    const grid = { scale: 8, offsetX: 0, offsetY: 0, cols: 32, rows: 24 };
    const { unmount } = render(<Harness initial={{ sampling: "pixelart" }} result={{ pattern: makePattern(["a"]), pixelGrid: grid }} />);
    expect(screen.getByText(/Found 32 × 24 pixels \(each 8 × 8\)/)).toBeTruthy();
    expect(screen.queryByLabelText("Smooth out noise")).toBeNull();
    unmount();
    render(<Harness initial={{ sampling: "pixelart" }} result={{ pattern: makePattern(["a"]), pixelArtFallback: true }} />);
    expect(screen.getByText(/No pixel grid found/)).toBeTruthy();
  });
});

describe("PatternView editing", () => {
  const pattern = makePattern(["ab", "a."]);
  const base = { pattern, boardSize: 26, showBoards: false, highlightId: null, theme: "dark", shape: "square" as const, codes: false, onPickColor: mock() };
  // 2 beads wide → 26px cells.
  const at = (x: number, y: number) => ({ clientX: x * 26 + 5, clientY: y * 26 + 5, pointerId: 1 });

  test("press and drag edits each cell once per stroke", () => {
    const onEdit = mock();
    const { container } = render(<PatternView {...base} tool="paint" onEdit={onEdit} />);
    const canvas = container.querySelector("canvas")!;
    fireEvent.pointerDown(canvas, at(0, 0));
    fireEvent.pointerMove(canvas, at(0, 0)); // same cell: ignored
    fireEvent.pointerMove(canvas, at(1, 0));
    fireEvent.pointerMove(canvas, at(1, 1));
    fireEvent.pointerUp(canvas, at(1, 1));
    fireEvent.pointerMove(canvas, at(0, 1)); // not pressed: ignored
    expect(onEdit.mock.calls).toEqual([
      [0, "start"],
      [1, "move"],
      [3, "move"],
    ]);
  });

  test("pick tool doesn't drag", () => {
    const onEdit = mock();
    const { container } = render(<PatternView {...base} tool="pick" onEdit={onEdit} />);
    const canvas = container.querySelector("canvas")!;
    fireEvent.pointerDown(canvas, at(1, 0));
    fireEvent.pointerMove(canvas, at(0, 0));
    expect(onEdit.mock.calls).toEqual([[1, "start"]]);
  });

  test("clicks don't highlight while editing", () => {
    const onPickColor = mock();
    const { container } = render(<PatternView {...base} onPickColor={onPickColor} tool="erase" onEdit={mock()} />);
    fireEvent.click(container.querySelector("canvas")!, at(0, 0));
    expect(onPickColor).not.toHaveBeenCalled();
    expect(container.querySelector(".pattern-status")!.textContent).toBe("Click or drag to remove beads.");
  });

  test("without a tool, pointer presses don't edit", () => {
    const onEdit = mock();
    const { container } = render(<PatternView {...base} onEdit={onEdit} />);
    fireEvent.pointerDown(container.querySelector("canvas")!, at(0, 0));
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe("App with an image", () => {
  // Every canvas read returns a red square on white, so the sample produces a real pattern.
  const redSquare = (w: number, h: number) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const inside = x >= w / 4 && x < (3 * w) / 4 && y >= h / 4 && y < (3 * h) / 4;
        data.set(inside ? [200, 30, 40, 255] : [255, 255, 255, 255], (y * w + x) * 4);
      }
    }
    return data;
  };

  async function loadSample() {
    mockPixels(redSquare);
    const utils = render(<App />);
    fireEvent.click(screen.getByText("Try a sample image"));
    await waitFor(() => expect(utils.container.querySelector(".pattern-canvas")).toBeTruthy());
    return utils;
  }
  const pill = () => screen.getByText(/beads · \d+ colours?$/).textContent;
  const canvas = (c: HTMLElement) => c.querySelector(".pattern-canvas")!;
  // 52 beads wide in a 600px view → 11.54px cells.
  const cellPx = 600 / 52;
  const at = (x: number, y: number) => ({ clientX: (x + 0.5) * cellPx, clientY: (y + 0.5) * cellPx, pointerId: 1 });

  test("builds a pattern from the image", async () => {
    await loadSample();
    expect(pill()).toBe("2,704 beads · 2 colours");
    expect(screen.getByText(/52 × 52 beads/)).toBeTruthy();
  });

  test("background removal and trim shrink the pattern to the subject", async () => {
    await loadSample();
    fireEvent.click(screen.getByLabelText("Remove background"));
    await waitFor(() => expect(pill()).toBe("676 beads · 1 colour"));
    fireEvent.click(screen.getByLabelText("Trim empty space"));
    await waitFor(() => expect(screen.getByText(/^\d+ × \d+ beads/).textContent).toMatch(/^5[0-2] × 5[0-2] beads/));
  });

  test("outline adds a ring of the darkest colour", async () => {
    await loadSample();
    fireEvent.click(screen.getByLabelText("Remove background"));
    fireEvent.click(screen.getByLabelText("Outline"));
    await waitFor(() => expect(pill()).toMatch(/· 2 colours$/));
    const darkestCode = mard.reduce((a, b) => (b.lab[0] < a.lab[0] ? b : a)).code;
    expect(screen.getByTitle("Outline colour").textContent).toContain(darkestCode);
  });

  test("paint, erase, undo and clear hand edits", async () => {
    const { container } = await loadSample();
    fireEvent.click(screen.getByText("Edit beads"));
    expect(screen.getByRole("radio", { name: "Paint" }).getAttribute("aria-checked")).toBe("true");

    // Erase a stroke of 3 beads in the white area.
    fireEvent.click(screen.getByRole("radio", { name: "Erase" }));
    fireEvent.pointerDown(canvas(container), at(0, 0));
    fireEvent.pointerMove(canvas(container), at(1, 0));
    fireEvent.pointerMove(canvas(container), at(2, 0));
    fireEvent.pointerUp(canvas(container), at(2, 0));
    await waitFor(() => expect(pill()).toBe("2,701 beads · 2 colours"));
    expect(screen.getByText("3 beads edited by hand")).toBeTruthy();

    // Pick red from the middle, then paint one white bead red.
    fireEvent.click(screen.getByRole("radio", { name: "Pick colour" }));
    fireEvent.pointerDown(canvas(container), at(26, 26));
    expect(screen.getByRole("radio", { name: "Paint" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.pointerDown(canvas(container), at(0, 51));
    fireEvent.pointerUp(canvas(container), at(0, 51));
    await waitFor(() => expect(screen.getByText("4 beads edited by hand")).toBeTruthy());

    // Undo is per stroke: the paint, then the 3-bead erase.
    fireEvent.click(screen.getByText("Undo"));
    await waitFor(() => expect(screen.getByText("3 beads edited by hand")).toBeTruthy());
    fireEvent.click(screen.getByText("Undo"));
    await waitFor(() => expect(pill()).toBe("2,704 beads · 2 colours"));
    expect((screen.getByText("Undo") as HTMLButtonElement).disabled).toBe(true);

    // Clear edits.
    fireEvent.click(screen.getByRole("radio", { name: "Erase" }));
    fireEvent.pointerDown(canvas(container), at(5, 5));
    fireEvent.pointerUp(canvas(container), at(5, 5));
    await waitFor(() => expect(pill()).toBe("2,703 beads · 2 colours"));
    fireEvent.click(screen.getByText("Clear edits"));
    await waitFor(() => expect(pill()).toBe("2,704 beads · 2 colours"));
  });

  test("hand edits are dropped when the grid size changes", async () => {
    const { container } = await loadSample();
    fireEvent.click(screen.getByText("Edit beads"));
    fireEvent.click(screen.getByRole("radio", { name: "Erase" }));
    fireEvent.pointerDown(canvas(container), at(0, 0));
    fireEvent.pointerUp(canvas(container), at(0, 0));
    await waitFor(() => expect(screen.getByText("1 bead edited by hand")).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByText("78"));
    });
    await waitFor(() => expect(screen.queryByText(/edited by hand/)).toBeNull());
    expect(pill()).toBe("6,084 beads · 2 colours");
  });

  test("brush colour can be chosen from the bead chart", async () => {
    await loadSample();
    fireEvent.click(screen.getByText("Edit beads"));
    fireEvent.click(screen.getByTitle("Brush colour"));
    const dialog = screen.getByRole("dialog", { name: "Brush colour" });
    fireEvent.click(within(dialog).getByTitle(mard[10]!.code));
    expect(screen.getByTitle("Brush colour").textContent).toContain(mard[10]!.code);
  });

  test("picking the background colour from the thumbnail", async () => {
    await loadSample();
    fireEvent.click(screen.getByLabelText("Remove background"));
    fireEvent.click(screen.getByText("Pick from image"));
    const thumb = screen.getByAltText("Source");
    expect(thumb.className).toBe("picking");
    // happy-dom reports a 0×0 thumbnail, so give it a size to click inside.
    thumb.getBoundingClientRect = () => ({ left: 0, top: 0, width: 84, height: 84, right: 84, bottom: 84, x: 0, y: 0, toJSON() {} });
    Object.defineProperty(thumb, "naturalWidth", { value: 1 });
    Object.defineProperty(thumb, "naturalHeight", { value: 1 });
    fireEvent.click(thumb, { clientX: 40, clientY: 40 });
    await waitFor(() => expect(screen.getByText("Auto")).toBeTruthy());
    expect(thumb.className).toBe("");
  });
});

import { describe, expect, mock, test } from "bun:test";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { App } from "../App";
import { mockPixels } from "../test/canvas-mock";
import { makePattern, mard } from "../test/fixtures";
import { DEFAULT_IMAGE_SETTINGS, ImageOptions, type ImageSettings } from "./ImageOptions";
import { PatternView } from "./PatternView";

describe("ImageOptions", () => {
  function Harness(props: { initial?: Partial<ImageSettings>; result?: Parameters<typeof ImageOptions>[0]["result"] }) {
    const [s, setS] = useState<ImageSettings>({ ...DEFAULT_IMAGE_SETTINGS, ...props.initial });
    const [picking, setPicking] = useState(false);
    return (
      <>
        <ImageOptions
          settings={s}
          onChange={setS}
          result={props.result ?? null}
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

  test("outline isn't an image option (it's an edit)", () => {
    render(<Harness />);
    expect(screen.queryByLabelText("Outline") === null).toBe(true);
    expect(screen.queryByTitle("Outline colour") === null).toBe(true);
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
      [0, "start", { shift: false, alt: false }],
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
    expect(onEdit.mock.calls).toEqual([[1, "start", { shift: false, alt: false }]]);
  });

  test("clicks don't highlight while editing", () => {
    const onPickColor = mock();
    const { container } = render(<PatternView {...base} onPickColor={onPickColor} tool="erase" onEdit={mock()} />);
    fireEvent.click(container.querySelector("canvas")!, at(0, 0));
    expect(onPickColor).not.toHaveBeenCalled();
    expect(container.querySelector(".pattern-status")!.textContent).toBe("Click or drag to remove beads · Shift-click erases a line.");
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
  const cellPx = 400 / 52; // the pattern is fitted into the 600 × 400 test box
  const at = (x: number, y: number) => ({ clientX: (x + 0.5) * cellPx, clientY: (y + 0.5) * cellPx, pointerId: 1 });

  test("builds a pattern from the image", async () => {
    await loadSample();
    expect(pill()).toBe("2,704 beads · 2 colours");
    expect(document.querySelector(".pattern-size")?.textContent).toBe("52 × 52 beads");
  });

  test("background removal and trim shrink the pattern to the subject", async () => {
    await loadSample();
    fireEvent.click(screen.getByLabelText("Remove background"));
    await waitFor(() => expect(pill()).toBe("676 beads · 1 colour"));
    fireEvent.click(screen.getByLabelText("Trim empty space"));
    await waitFor(() => expect(document.querySelector(".pattern-size")?.textContent).toMatch(/^5[0-2] × 5[0-2] beads/));
  });

  test("Add outline adds a ring of the darkest colour", async () => {
    await loadSample();
    fireEvent.click(screen.getByLabelText("Remove background"));
    fireEvent.click(screen.getByText("Edit beads"));
    fireEvent.click(screen.getByText("Add outline"));
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
    // Changing the size with hand edits asks first.
    const prompt = screen.getByRole("alertdialog", { name: "Hand edits may be lost" });
    expect(prompt.textContent).toContain("You've edited 1 bead by hand");
    await act(async () => {
      fireEvent.click(within(prompt).getByText("Change anyway"));
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

describe("outline as an edit", () => {
  const redSquare = (w: number, h: number) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const inside = x >= w / 4 && x < (3 * w) / 4 && y >= h / 4 && y < (3 * h) / 4;
      data.set(inside ? [200, 30, 40, 255] : [255, 255, 255, 255], (y * w + x) * 4);
    }
    return data;
  };
  const solid = (w: number, h: number) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set([200, 30, 40, 255], i * 4);
    return data;
  };
  const darkest = mard.reduce((a, b) => (b.lab[0] < a.lab[0] ? b : a));
  const cellPx = 400 / 52; // the pattern is fitted into the 600 × 400 test box
  const at = (x: number, y: number) => ({ clientX: (x + 0.5) * cellPx, clientY: (y + 0.5) * cellPx, pointerId: 1 });
  const canvas = () => document.querySelector(".pattern-canvas")!;
  /** The colour code under a cell, via the hover status line. */
  const codeAt = (x: number, y: number) => {
    fireEvent.mouseMove(canvas(), at(x, y));
    const text = document.querySelector(".pattern-status")!.textContent!;
    return text.includes("empty peg") ? null : text.split(" · ")[1]!.trim();
  };
  const outlineCount = () => {
    const row = screen.getAllByRole("listitem").find((li) => li.querySelector(".bead-name b")?.textContent === darkest.code);
    return row ? Number(row.querySelector(".bead-count")!.textContent!.replace(/,/g, "")) : 0;
  };
  const stroke = (x: number, y: number) => {
    fireEvent.pointerDown(canvas(), at(x, y));
    fireEvent.pointerUp(canvas(), at(x, y));
  };
  const toast = () => document.querySelector(".toast")?.textContent ?? "";

  async function setup(pixels = redSquare, removeBackground = true) {
    mockPixels(pixels);
    render(<App />);
    fireEvent.click(screen.getByText("Try a sample image"));
    await waitFor(() => expect(document.querySelector(".pattern-canvas")).toBeTruthy());
    if (removeBackground) fireEvent.click(screen.getByLabelText("Remove background"));
    fireEvent.click(screen.getByText("Edit beads"));
  }
  async function outlined() {
    await setup();
    fireEvent.click(screen.getByText("Add outline"));
    await waitFor(() => expect(outlineCount()).toBeGreaterThan(0));
    return outlineCount();
  }

  test("the outline is ordinary hand edits, removed in one Undo", async () => {
    const n = await outlined();
    expect(toast()).toBe("Outline added");
    expect(screen.getByText(`${n} beads edited by hand`)).toBeTruthy();
    fireEvent.click(screen.getByText("Undo"));
    await waitFor(() => expect(outlineCount()).toBe(0));
    expect(screen.queryByText(/edited by hand/) === null).toBe(true);
  });

  test("erasing a bead at the shape's edge leaves it empty, and the outline stays put", async () => {
    const n = await outlined();
    let x = 0;
    while (x < 52 && codeAt(x, 26) === null) x++;
    expect(codeAt(x, 26)).toBe(darkest.code); // the outline…
    expect(codeAt(x + 1, 26)).not.toBe(darkest.code); // …then the shape's edge
    fireEvent.click(screen.getByRole("radio", { name: "Erase" }));
    stroke(x + 1, 26);
    await waitFor(() => expect(codeAt(x + 1, 26)).toBeNull());
    expect(outlineCount()).toBe(n);
    // Outline beads can be erased like any other.
    stroke(x, 26);
    await waitFor(() => expect(codeAt(x, 26)).toBeNull());
    expect(outlineCount()).toBe(n - 1);
  });

  test("beads painted after the outline don't get outlined; adding again outlines the new shape", async () => {
    const n = await outlined();
    fireEvent.click(screen.getByRole("radio", { name: "Pick colour" }));
    stroke(26, 26); // pick the red
    stroke(4, 4); // paint far outside the shape
    await waitFor(() => expect(codeAt(4, 4)).not.toBeNull());
    expect(codeAt(3, 3)).toBeNull();
    fireEvent.click(screen.getByText("Add outline"));
    await waitFor(() => expect(codeAt(3, 3)).toBe(darkest.code));
    expect(outlineCount()).toBeGreaterThan(n + 8); // the bead's ring plus a second ring round the shape
  });

  test("with no room round the shape, Edge margin makes room", async () => {
    await setup(solid, false);
    fireEvent.click(screen.getByText("Add outline"));
    expect(toast()).toContain("Nothing to outline");
    fireEvent.click(screen.getByLabelText("Edge margin"));
    await waitFor(() => expect(codeAt(0, 0)).toBeNull());
    fireEvent.click(screen.getByText("Add outline"));
    await waitFor(() => expect(outlineCount()).toBe(2 * 54 + 2 * 52)); // the ring round a 52 × 52 image on a 54 × 54 grid
  });

  test("Edge margin grows the grid and keeps hand edits in place (shifted by one)", async () => {
    const n = await outlined();
    let x = 0;
    while (x < 52 && codeAt(x, 26) === null) x++;
    fireEvent.click(screen.getByRole("radio", { name: "Erase" }));
    stroke(x + 1, 26); // an edge bead of the shape
    await waitFor(() => expect(codeAt(x + 1, 26)).toBeNull());
    const size = () => document.querySelector(".pattern-size")!.textContent;
    expect(size()).toBe("52 × 52 beads");

    fireEvent.click(screen.getByLabelText("Edge margin"));
    expect(screen.queryByRole("alertdialog") === null).toBe(true); // nothing to warn about
    await waitFor(() => expect(size()).toBe("54 × 54 beads"));
    expect(outlineCount()).toBe(n);
    expect(screen.getByText(`${n + 1} beads edited by hand`)).toBeTruthy();
    // Cells are 600/54 px now.
    const at54 = (cx: number, cy: number) => ({ clientX: (cx + 0.5) * (400 / 54), clientY: (cy + 0.5) * (400 / 54), pointerId: 1 });
    const code54 = (cx: number, cy: number) => {
      fireEvent.mouseMove(canvas(), at54(cx, cy));
      const text = document.querySelector(".pattern-status")!.textContent!;
      return text.includes("empty peg") ? null : text.split(" · ")[1]!.trim();
    };
    expect(code54(x + 1, 27)).toBe(darkest.code); // the outline, one bead over
    expect(code54(x + 2, 27)).toBeNull(); // the erased bead, still erased

    // Undo still undoes the last stroke (on the shifted grid).
    fireEvent.click(screen.getByText("Undo"));
    await waitFor(() => expect(code54(x + 2, 27)).not.toBeNull());

    fireEvent.click(screen.getByLabelText("Edge margin"));
    await waitFor(() => expect(size()).toBe("52 × 52 beads"));
    expect(outlineCount()).toBe(n);
  });

  test("warns when the outline is cut off at the edge", async () => {
    const disc = (w: number, h: number) => {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const inside = (x - w / 2) ** 2 + (y - h / 2) ** 2 < (w / 4) ** 2;
        data.set(inside ? [200, 30, 40, 255] : [255, 255, 255, 255], (y * w + x) * 4);
      }
      return data;
    };
    await setup(disc);
    fireEvent.click(screen.getByLabelText("Trim empty space"));
    // (The canvas mock redraws the whole disc for the trimmed area, so the size wobbles a bead.)
    await waitFor(() => expect(document.querySelector(".pattern-size")?.textContent).toMatch(/^5\d × 5\d beads/));
    fireEvent.click(screen.getByText("Add outline"));
    expect(toast()).toContain("cut off");
  });
});

describe("warning before settings change hand edits", () => {
  const solid = (w: number, h: number) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set([200, 30, 40, 255], i * 4);
    return data;
  };
  const prompt = () => screen.queryByRole("alertdialog", { name: "Hand edits may be lost" });
  const cellPx = 400 / 52; // the pattern is fitted into the 600 × 400 test box
  const erase = (x: number, y: number) => {
    const c = document.querySelector(".pattern-canvas")!;
    fireEvent.pointerDown(c, { clientX: (x + 0.5) * cellPx, clientY: (y + 0.5) * cellPx, pointerId: 1 });
    fireEvent.pointerUp(c, { clientX: (x + 0.5) * cellPx, clientY: (y + 0.5) * cellPx, pointerId: 1 });
  };

  async function withEdit() {
    mockPixels(solid);
    render(<App />);
    fireEvent.click(screen.getByText("Try a sample image"));
    await waitFor(() => expect(document.querySelector(".pattern-canvas")).toBeTruthy());
    fireEvent.click(screen.getByText("Edit beads"));
    fireEvent.click(screen.getByRole("radio", { name: "Erase" }));
    erase(3, 3);
    await waitFor(() => expect(screen.getByText("1 bead edited by hand")).toBeTruthy());
  }

  test("no warning without hand edits", async () => {
    mockPixels(solid);
    render(<App />);
    fireEvent.click(screen.getByText("Try a sample image"));
    await waitFor(() => expect(document.querySelector(".pattern-canvas")).toBeTruthy());
    fireEvent.click(screen.getByRole("radio", { name: "Sharp" }));
    expect(prompt() === null).toBe(true);
    expect(screen.getByRole("radio", { name: "Sharp" }).getAttribute("aria-checked")).toBe("true");
  });

  test("Cancel leaves the setting as it was", async () => {
    await withEdit();
    fireEvent.click(screen.getByRole("radio", { name: "Sharp" }));
    fireEvent.click(within(prompt()!).getByText("Cancel"));
    expect(screen.getByRole("radio", { name: "Smooth" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("1 bead edited by hand")).toBeTruthy();
  });

  test("Clear edits and change", async () => {
    await withEdit();
    fireEvent.click(screen.getByText("78"));
    fireEvent.click(within(prompt()!).getByText("Clear edits and change"));
    await waitFor(() => expect(screen.queryByText(/edited by hand/) === null).toBe(true));
    expect(screen.getByText("78").className).toBe("on");
  });

  test("Change anyway isn't asked again until the next stroke", async () => {
    await withEdit();
    fireEvent.click(screen.getByRole("radio", { name: "Sharp" }));
    fireEvent.click(within(prompt()!).getByText("Change anyway"));
    fireEvent.click(screen.getByRole("radio", { name: "Smooth" }));
    expect(prompt() === null).toBe(true); // acknowledged
    erase(5, 5); // a new stroke…
    await waitFor(() => expect(screen.getByText("2 beads edited by hand")).toBeTruthy());
    fireEvent.click(screen.getByRole("radio", { name: "Sharp" }));
    expect(prompt()).toBeTruthy(); // …asks again
  });

  test("display options don't ask (they don't move beads)", async () => {
    await withEdit();
    fireEvent.click(screen.getByLabelText("Codes"));
    expect(prompt() === null).toBe(true);
  });

  test("Edge margin doesn't ask (it keeps hand edits)", async () => {
    await withEdit();
    fireEvent.click(screen.getByLabelText("Edge margin"));
    expect(prompt() === null).toBe(true);
    await waitFor(() => expect(document.querySelector(".pattern-size")!.textContent).toBe("54 × 54 beads"));
    expect(screen.getByText("1 bead edited by hand")).toBeTruthy();
  });
});

describe("editing tools in the app", () => {
  const solid = (w: number, h: number) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(x < w / 2 ? [200, 30, 40, 255] : [40, 90, 200, 255], (y * w + x) * 4);
    return data;
  };
  const cellPx = 400 / 52;
  const at = (x: number, y: number, extra = {}) => ({ clientX: (x + 0.5) * cellPx, clientY: (y + 0.5) * cellPx, pointerId: 1, ...extra });
  const canvas = () => document.querySelector(".pattern-canvas")!;
  const click = (x: number, y: number, extra = {}) => {
    fireEvent.pointerDown(canvas(), at(x, y, extra));
    fireEvent.pointerUp(canvas(), at(x, y, extra));
  };
  const edited = () => Number(screen.queryByText(/edited by hand/)?.textContent?.match(/[\d,]+/)?.[0]?.replace(/,/g, "") ?? 0);
  const key = (k: string, extra = {}) => fireEvent.keyDown(window, { key: k, ...extra });

  async function editing() {
    mockPixels(solid);
    render(<App />);
    fireEvent.click(screen.getByText("Try a sample image"));
    await waitFor(() => expect(canvas()).toBeTruthy());
    fireEvent.click(screen.getByText("Edit beads"));
  }

  test("brush size 3 paints a 3 × 3 square; ] and [ change the size", async () => {
    await editing();
    key("e"); // erase: a change on any bead counts
    key("]");
    key("]");
    expect(within(screen.getByRole("radiogroup", { name: "Brush size" })).getByRole("radio", { name: "3" }).getAttribute("aria-checked")).toBe("true");
    click(10, 10);
    await waitFor(() => expect(edited()).toBe(9));
    key("[");
    expect(within(screen.getByRole("radiogroup", { name: "Brush size" })).getByRole("radio", { name: "2" }).getAttribute("aria-checked")).toBe("true");
  });

  test("Shift-click erases a straight line from the last bead", async () => {
    await editing();
    key("e");
    click(5, 5);
    click(15, 5, { shiftKey: true });
    await waitFor(() => expect(edited()).toBe(11));
  });

  test("fill and replace take a whole area in one undo step; redo brings it back", async () => {
    await editing();
    key("g");
    expect(screen.getByRole("radio", { name: "Fill" }).getAttribute("aria-checked")).toBe("true");
    click(40, 10); // the blue half: 26 × 52
    await waitFor(() => expect(edited()).toBe(26 * 52));
    key("z", { metaKey: true });
    await waitFor(() => expect(edited()).toBe(0));
    key("z", { metaKey: true, shiftKey: true });
    await waitFor(() => expect(edited()).toBe(26 * 52));
    key("r");
    expect(screen.getByRole("radio", { name: "Replace" }).getAttribute("aria-checked")).toBe("true");
  });

  test("Alt-click picks a colour; Esc finishes editing", async () => {
    await editing();
    key("e");
    click(40, 10, { altKey: true }); // picks blue, back to paint, nothing edited
    expect(screen.getByRole("radio", { name: "Paint" }).getAttribute("aria-checked")).toBe("true");
    expect(edited()).toBe(0);
    key("Escape");
    expect(screen.getByText("Edit beads")).toBeTruthy();
  });
});

describe("build mode", () => {
  const halves = (w: number, h: number) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(x < w / 2 ? [200, 30, 40, 255] : [40, 90, 200, 255], (y * w + x) * 4);
    return data;
  };
  const progress = () => screen.getByTestId("build-progress").textContent;

  test("tick beads off board by board; progress shows on the Build button", async () => {
    mockPixels(halves);
    render(<App />);
    fireEvent.click(screen.getByText("Try a sample image"));
    await waitFor(() => expect(document.querySelector(".pattern-canvas")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    const dlg = screen.getByRole("dialog", { name: "Build mode" });
    expect(progress()).toBe("0 of 2,704 placed · 0%");
    expect(within(dlg).getByText("Board 1 of 4")).toBeTruthy(); // 52 × 52 on 26-peg boards

    // Tap a bead (the board canvas is fitted into the 600 × 400 test box: 26 beads → 15 px).
    const canvas = dlg.querySelector(".build-canvas")!;
    fireEvent.pointerDown(canvas, { clientX: 7, clientY: 7, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    expect(progress()).toBe("1 of 2,704 placed · 0%");

    fireEvent.click(within(dlg).getByText("✓ Board done"));
    expect(progress()).toBe("676 of 2,704 placed · 25%");
    expect(within(dlg).getByText("Board 2 of 4")).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(within(dlg).getByText(/Board 1 of 4/)).toBeTruthy();
    expect(within(dlg).getByText(/done ✓/)).toBeTruthy();

    // Bead shapes, shared with the main view.
    expect(within(dlg).getByRole("radio", { name: "Square" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(dlg).getByRole("radio", { name: "Bead" }));
    expect(within(dlg).getByRole("radio", { name: "Bead" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Build mode" }) === null).toBe(true);
    expect(screen.getByRole("button", { name: "Build · 25%" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Bead" }).getAttribute("aria-checked")).toBe("true");
  });
});

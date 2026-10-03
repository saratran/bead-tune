import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "../App";
import { listProjects } from "../lib/projects";
import { mockPixels, PNG_DATA_URL } from "../test/canvas-mock";
import { makePattern } from "../test/fixtures";
import { canvasScale, PatternView } from "./PatternView";

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

const png = () => {
  const bytes = Uint8Array.from(atob(PNG_DATA_URL.split(",")[1]!), (c) => c.charCodeAt(0));
  return new File([bytes], "dog.png", { type: "image/png" });
};

describe("canvasScale", () => {
  test("uses the device pixel ratio when the canvas is small enough", () => {
    expect(canvasScale(1000, 800, 2)).toBe(2);
  });

  test("lowers the resolution to stay within browser canvas limits", () => {
    const s = canvasScale(12_000, 12_000, 2);
    expect(12_000 * s).toBeLessThanOrEqual(8192);
    expect(12_000 * s * 12_000 * s).toBeLessThanOrEqual(16_000_000 + 1);
  });
});

describe("PatternView fullscreen", () => {
  // happy-dom has no layout, so the viewport is the default 600 × 400.
  const pattern = makePattern(Array(8).fill("ababababab"));
  const base = { pattern, boardSize: 26, showBoards: false, highlightId: null, theme: "dark", shape: "square" as const, codes: false };
  const width = (c: HTMLElement) => c.querySelector("canvas")!.style.width;

  test("fits the whole pattern, then scales with zoom", () => {
    // 10 × 8 beads in 600 × 400 → height limits: 50px cells.
    const { container, rerender } = render(<PatternView {...base} onPickColor={mock()} fullscreen />);
    expect(width(container)).toBe("500px");
    rerender(<PatternView {...base} onPickColor={mock()} fullscreen zoom={2} />);
    expect(width(container)).toBe("1000px");
  });

  test("caps very large zoom", () => {
    const { container } = render(<PatternView {...base} onPickColor={mock()} fullscreen zoom={8} />);
    expect(width(container)).toBe("1200px"); // 120px max cells
  });

  test("Ctrl/⌘ + wheel zooms; a plain wheel scrolls", () => {
    const onZoom = mock();
    const { container } = render(<PatternView {...base} onPickColor={mock()} fullscreen onZoom={onZoom} />);
    const scroller = container.querySelector(".pattern-scroll")!;
    // happy-dom's WheelEvent drops modifier keys, so set them on the event directly.
    const wheel = (deltaY: number, mods: { ctrlKey?: boolean; metaKey?: boolean } = {}) => {
      const e = new WheelEvent("wheel", { deltaY, cancelable: true, bubbles: true });
      Object.defineProperties(e, { ctrlKey: { value: !!mods.ctrlKey }, metaKey: { value: !!mods.metaKey } });
      scroller.dispatchEvent(e);
      return e;
    };
    expect(wheel(100).defaultPrevented).toBe(false);
    expect(onZoom).not.toHaveBeenCalled();
    expect(wheel(-100, { ctrlKey: true }).defaultPrevented).toBe(true); // page zoom suppressed
    expect(onZoom.mock.lastCall![0]).toBeCloseTo(Math.exp(0.2));
    wheel(100, { metaKey: true });
    expect(onZoom.mock.lastCall![0]).toBeLessThan(1);
  });

  test("two-finger pinch zooms by the change in finger distance", () => {
    const onZoom = mock();
    const onEdit = mock();
    const { container } = render(<PatternView {...base} onPickColor={mock()} fullscreen onZoom={onZoom} tool="paint" onEdit={onEdit} />);
    const canvas = container.querySelector("canvas")!;
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerDown(canvas, { pointerId: 2, clientX: 110, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 210, clientY: 10 });
    expect(onZoom.mock.lastCall![0]).toBeCloseTo(2);
    // Painting stopped when the second finger landed.
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 160, clientY: 10 });
    expect(onEdit.mock.calls).toEqual([[0, "start"]]);
  });

  test("dragging pans instead of highlighting; a plain tap still highlights", () => {
    const onPickColor = mock();
    const { container } = render(<PatternView {...base} onPickColor={onPickColor} fullscreen />);
    const canvas = container.querySelector("canvas")!;
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 60, clientY: 20 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 60, clientY: 20 });
    fireEvent.click(canvas, { clientX: 60, clientY: 20 });
    expect(onPickColor).not.toHaveBeenCalled();

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.click(canvas, { clientX: 20, clientY: 20 });
    expect(onPickColor).toHaveBeenCalledWith(pattern.colors[0]!.id);
  });

  test("explains the controls", () => {
    const { container } = render(<PatternView {...base} onPickColor={mock()} fullscreen />);
    expect(container.querySelector(".pattern-status")!.textContent).toContain("pinch or Ctrl+scroll to zoom");
  });
});

describe("fullscreen in the app", () => {
  const requestFullscreen = mock(() => Promise.resolve());
  const exitFullscreen = mock(() => Promise.resolve());
  let fsElement: Element | null = null;

  beforeEach(() => {
    requestFullscreen.mockClear();
    exitFullscreen.mockClear();
    fsElement = null;
    Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: requestFullscreen });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exitFullscreen });
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fsElement });
  });
  afterEach(() => {
    delete (document.documentElement as { requestFullscreen?: unknown }).requestFullscreen;
    delete (document as { exitFullscreen?: unknown }).exitFullscreen;
    delete (document as { fullscreenElement?: unknown }).fullscreenElement;
  });

  async function openFullscreen() {
    mockPixels(redSquare);
    const utils = render(<App />);
    expect(screen.queryByText(/Fullscreen/) === null).toBe(true); // not offered before there's a pattern
    fireEvent.click(screen.getByText("Try a sample image"));
    await waitFor(() => expect(utils.container.querySelector(".pattern-canvas")).toBeTruthy());
    fireEvent.click(screen.getByText(/Fullscreen/));
    fsElement = document.documentElement;
    return screen.getByRole("dialog", { name: "Fullscreen pattern" });
  }

  test("opens the viewer and requests browser fullscreen for the whole page", async () => {
    const fs = await openFullscreen();
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(within(fs).getByText("52 × 52 · 2,704 beads")).toBeTruthy();
    expect(within(fs).getByText("100%")).toBeTruthy();
    expect(document.body.style.overflow).toBe("hidden");
  });

  test("Exit closes it and leaves browser fullscreen", async () => {
    const fs = await openFullscreen();
    fireEvent.click(within(fs).getByLabelText("Exit fullscreen"));
    expect(screen.queryByRole("dialog", { name: "Fullscreen pattern" }) === null).toBe(true);
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(document.body.style.overflow).toBe("");
  });

  test("Esc closes it", async () => {
    await openFullscreen();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Fullscreen pattern" }) === null).toBe(true);
  });

  test("leaving browser fullscreen another way closes the viewer too", async () => {
    await openFullscreen();
    fsElement = null;
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(screen.queryByRole("dialog", { name: "Fullscreen pattern" }) === null).toBe(true);
  });

  test("zoom buttons and keys", async () => {
    const fs = await openFullscreen();
    const level = () => fs.querySelector(".zoom-level")!.textContent;
    expect((within(fs).getByLabelText("Zoom out") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(fs).getByLabelText("Zoom in"));
    expect(level()).toBe("125%");
    fireEvent.keyDown(window, { key: "+" });
    expect(level()).toBe("156%");
    fireEvent.keyDown(window, { key: "-" });
    expect(level()).toBe("125%");
    fireEvent.keyDown(window, { key: "0" });
    expect(level()).toBe("100%");
    fireEvent.keyDown(window, { key: "-" });
    expect(level()).toBe("100%"); // can't go below fit
    fireEvent.click(within(fs).getByLabelText("Zoom in"));
    fireEvent.click(within(fs).getByText("Fit"));
    expect(level()).toBe("100%");
  });

  test("edit beads in fullscreen, with Ctrl/⌘+Z to undo", async () => {
    const fs = await openFullscreen();
    fireEvent.click(within(fs).getByText("Edit beads"));
    fireEvent.click(within(fs).getByRole("radio", { name: "Erase" }));
    // 52 × 52 in the 600 × 400 viewport → 400/52 px cells.
    const cell = 400 / 52;
    const canvas = fs.querySelector("canvas")!;
    const at = (x: number, y: number) => ({ pointerId: 1, clientX: (x + 0.5) * cell, clientY: (y + 0.5) * cell });
    fireEvent.pointerDown(canvas, at(0, 0));
    fireEvent.pointerMove(canvas, at(1, 0));
    fireEvent.pointerUp(canvas, at(1, 0));
    await waitFor(() => expect(within(fs).getByText("52 × 52 · 2,702 beads")).toBeTruthy());
    // The edit bar lives in the viewer, not twice on the page.
    expect(screen.getAllByRole("radiogroup", { name: "Edit tool" })).toHaveLength(1);

    fireEvent.keyDown(window, { key: "z", metaKey: true });
    await waitFor(() => expect(within(fs).getByText("52 × 52 · 2,704 beads")).toBeTruthy());
  });

  test("display settings are shared with the page", async () => {
    const fs = await openFullscreen();
    fireEvent.click(within(fs).getByLabelText("Codes"));
    fireEvent.click(within(fs).getByLabelText("Exit fullscreen"));
    expect((screen.getByLabelText("Codes") as HTMLInputElement).checked).toBe(true);
  });

  test("works without the Fullscreen API (e.g. iPhone)", async () => {
    delete (document.documentElement as { requestFullscreen?: unknown }).requestFullscreen;
    mockPixels(redSquare);
    const { container } = render(<App />);
    fireEvent.click(screen.getByText("Try a sample image"));
    await waitFor(() => expect(container.querySelector(".pattern-canvas")).toBeTruthy());
    fireEvent.click(screen.getByText(/Fullscreen/));
    expect(screen.getByRole("dialog", { name: "Fullscreen pattern" })).toBeTruthy();
  });
});

describe("discard unsaved changes prompt", () => {
  async function savedProjectWithChanges() {
    mockPixels(redSquare);
    const utils = render(<App />);
    fireEvent.click(screen.getByText("Try a sample image"));
    await waitFor(() => expect(utils.container.querySelector(".pattern-canvas")).toBeTruthy());
    fireEvent.click(screen.getByText("Projects"));
    const d = screen.getByRole("dialog", { name: "Projects" });
    fireEvent.change(within(d).getByLabelText("Save this pattern"), { target: { value: "Berry" } });
    fireEvent.click(within(d).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(d).getByText("Berry")).toBeTruthy());
    fireEvent.click(within(d).getByLabelText("Close"));
    fireEvent.click(screen.getByText("78"));
    await waitFor(() => expect(screen.getByLabelText("Unsaved changes")).toBeTruthy());
    return utils;
  }
  const pickFile = () => fireEvent.change(document.querySelector("input[type=file]")!, { target: { files: [png()] } });
  const prompt = () => screen.findByRole("alertdialog", { name: "Unsaved changes" });
  const projectName = () => document.querySelector(".project-status")?.textContent ?? null;

  test("Cancel keeps the current work", async () => {
    await savedProjectWithChanges();
    pickFile();
    fireEvent.click(within(await prompt()).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog") === null).toBe(true));
    expect(projectName()).toBe("Berry");
    expect(screen.getByText("78").className).toBe("on");
  });

  test("Discard replaces it", async () => {
    await savedProjectWithChanges();
    pickFile();
    fireEvent.click(within(await prompt()).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(projectName()).toBeNull());
    expect((await listProjects())[0]!.state.width).toBe(52); // change was not saved
  });

  test("Save first saves, then continues", async () => {
    await savedProjectWithChanges();
    pickFile();
    fireEvent.click(within(await prompt()).getByRole("button", { name: "Save first" }));
    await waitFor(() => expect(projectName()).toBeNull());
    expect((await listProjects())[0]!.state.width).toBe(78);
  });

  test("an unsaved image with hand edits offers to save it as a project", async () => {
    mockPixels(redSquare);
    const { container } = render(<App />);
    fireEvent.click(screen.getByText("Try a sample image"));
    await waitFor(() => expect(container.querySelector(".pattern-canvas")).toBeTruthy());
    fireEvent.click(screen.getByText("Edit beads"));
    fireEvent.click(screen.getByRole("radio", { name: "Erase" }));
    const canvas = container.querySelector(".pattern-canvas")!;
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 5, clientY: 5 });
    await waitFor(() => expect(screen.getByText("1 bead edited by hand")).toBeTruthy());

    pickFile();
    const p = await prompt();
    expect(p.textContent).toContain("hasn't been saved as a project");
    fireEvent.click(within(p).getByRole("button", { name: "Save as project…" }));
    expect(screen.getByRole("dialog", { name: "Projects" })).toBeTruthy();
    expect(screen.getByText("1 bead edited by hand")).toBeTruthy(); // image not replaced
  });

  test("no prompt when nothing would be lost", async () => {
    mockPixels(redSquare);
    const { container } = render(<App />);
    fireEvent.click(screen.getByText("Try a sample image"));
    await waitFor(() => expect(container.querySelector(".pattern-canvas")).toBeTruthy());
    fireEvent.click(screen.getByText("78")); // settings changes alone on an unsaved image don't count
    pickFile();
    expect(screen.queryByRole("alertdialog") === null).toBe(true);
    // The new image loaded straight away: the save dialog now defaults to its name.
    const defaultName = async () => {
      fireEvent.click(screen.getByRole("button", { name: "Projects" }));
      const value = (screen.getByLabelText("Save this pattern") as HTMLInputElement).value;
      fireEvent.click(within(screen.getByRole("dialog", { name: "Projects" })).getByLabelText("Close"));
      return value;
    };
    for (let i = 0; i < 20 && (await defaultName()) !== "dog"; i++) await new Promise((r) => setTimeout(r, 25));
    expect(await defaultName()).toBe("dog");
  });

  test("the browser warns before leaving with unsaved changes", async () => {
    await savedProjectWithChanges();
    const leave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);

    fireEvent.click(screen.getAllByText("Save")[0]!);
    await waitFor(() => expect(screen.queryByLabelText("Unsaved changes") === null).toBe(true));
    const again = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(again);
    expect(again.defaultPrevented).toBe(false);
  });
});

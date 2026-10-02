import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "../App";
import { FULL_CROP } from "../lib/crop";
import { listProjects } from "../lib/projects";
import { mockPixels, PNG_DATA_URL } from "../test/canvas-mock";
import { CropDialog } from "./CropDialog";
import { OriginalView } from "./OriginalView";

/** A fake 200 × 100 image (happy-dom doesn't decode real sizes). */
function fakeImage(w = 200, h = 100): HTMLImageElement {
  const img = new Image();
  Object.defineProperties(img, { naturalWidth: { value: w }, naturalHeight: { value: h }, width: { value: w }, height: { value: h } });
  img.src = PNG_DATA_URL;
  return img;
}

/** happy-dom has no layout: give the crop frame a 400 × 200 box on screen. */
function sizeFrame() {
  const frame = document.querySelector(".crop-frame") as HTMLElement;
  frame.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200, x: 0, y: 0, toJSON() {} });
  return frame;
}

const drag = (frame: HTMLElement, target: Element, from: [number, number], to: [number, number]) => {
  fireEvent.pointerDown(target, { pointerId: 1, clientX: from[0], clientY: from[1] });
  fireEvent.pointerMove(frame, { pointerId: 1, clientX: to[0], clientY: to[1] });
  fireEvent.pointerUp(frame, { pointerId: 1, clientX: to[0], clientY: to[1] });
};

describe("CropDialog", () => {
  test("drag a corner to resize, then apply", () => {
    const onApply = mock();
    render(<CropDialog image={fakeImage()} crop={FULL_CROP} onApply={onApply} onClose={mock()} />);
    const frame = sizeFrame();
    expect(screen.getByText("200 × 100 px")).toBeTruthy();
    // Bottom-right corner from (400,200) to (200,100): half the width and height.
    drag(frame, document.querySelector('[data-handle="se"]')!, [400, 200], [200, 100]);
    expect(screen.getByText("100 × 50 px")).toBeTruthy();
    fireEvent.click(screen.getByText("Apply crop"));
    expect(onApply.mock.lastCall![0]).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 });
  });

  test("drag inside the frame to move it", () => {
    const onApply = mock();
    render(<CropDialog image={fakeImage()} crop={{ x: 0, y: 0, w: 0.5, h: 0.5 }} onApply={onApply} onClose={mock()} />);
    const frame = sizeFrame();
    drag(frame, screen.getByTestId("crop-box"), [50, 50], [150, 100]);
    fireEvent.click(screen.getByText("Apply crop"));
    expect(onApply.mock.lastCall![0]).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  });

  test("square shape fits a pixel-square inside the current crop", () => {
    render(<CropDialog image={fakeImage()} crop={FULL_CROP} onApply={mock()} onClose={mock()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Square" }));
    expect(screen.getByText("100 × 100 px")).toBeTruthy();
  });

  test("reset returns to the whole image; applying it clears the crop", () => {
    const onApply = mock();
    render(<CropDialog image={fakeImage()} crop={{ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }} onApply={onApply} onClose={mock()} />);
    fireEvent.click(screen.getByText("Reset"));
    expect(screen.getByText("200 × 100 px")).toBeTruthy();
    expect((screen.getByText("Reset") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("Apply crop"));
    expect(onApply.mock.lastCall![0]).toEqual(FULL_CROP);
  });

  test("Cancel and Esc close without applying", () => {
    const onApply = mock();
    const onClose = mock();
    render(<CropDialog image={fakeImage()} crop={FULL_CROP} onApply={onApply} onClose={onClose} />);
    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe("OriginalView", () => {
  test("zoom buttons, fit and hide", () => {
    const onHide = mock();
    render(<OriginalView image={fakeImage()} crop={FULL_CROP} onHide={onHide} />);
    const level = () => document.querySelector(".original-view .zoom-level")!.textContent;
    expect(level()).toBe("100%");
    expect((screen.getByLabelText("Zoom original out") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Zoom original in"));
    fireEvent.click(screen.getByLabelText("Zoom original in"));
    expect(level()).toBe("156%");
    fireEvent.click(within(document.querySelector(".original-view") as HTMLElement).getByText("Fit"));
    expect(level()).toBe("100%");
    fireEvent.click(screen.getByLabelText("Hide original"));
    expect(onHide).toHaveBeenCalled();
  });

  test("fits the image into the panel and grows with zoom", () => {
    // Default panel 400 × 300; a 200 × 100 image fits at 2× → 400 × 200.
    const { container } = render(<OriginalView image={fakeImage()} crop={FULL_CROP} onHide={mock()} />);
    const canvas = container.querySelector("canvas")!;
    expect([canvas.style.width, canvas.style.height]).toEqual(["400px", "200px"]);
    fireEvent.click(screen.getByLabelText("Zoom original in"));
    expect(canvas.style.width).toBe("500px");
  });

  test("shows the cropped area, or the whole image with the crop outlined", () => {
    const { container } = render(<OriginalView image={fakeImage()} crop={{ x: 0.5, y: 0, w: 0.5, h: 1 }} onHide={mock()} />);
    const canvas = container.querySelector("canvas")!;
    // Crop is 100 × 100 px → fits 300 × 300 in the 400 × 300 panel.
    expect(canvas.style.width).toBe("300px");
    fireEvent.click(screen.getByRole("radio", { name: "Whole" }));
    expect(canvas.style.width).toBe("400px");
  });

  test("the crop/whole switch only appears when the image is cropped", () => {
    render(<OriginalView image={fakeImage()} crop={FULL_CROP} onHide={mock()} />);
    expect(screen.queryByRole("radio", { name: "Whole" }) === null).toBe(true);
  });
});

describe("crop and original in the app", () => {
  const redSquare = (w: number, h: number) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set([200, 30, 40, 255], i * 4);
    return data;
  };

  async function loadSample() {
    mockPixels(redSquare);
    const utils = render(<App />);
    fireEvent.click(screen.getByText("Try a sample image"));
    await waitFor(() => expect(utils.container.querySelector(".pattern-canvas")).toBeTruthy());
    return utils;
  }

  async function cropToLeftHalf() {
    fireEvent.click(screen.getByText("✂ Crop"));
    const frame = sizeFrame();
    drag(frame, document.querySelector('[data-handle="e"]')!, [400, 100], [200, 100]);
    fireEvent.click(screen.getByText("Apply crop"));
  }

  test("cropping changes the pattern and shows a status with a remove link", async () => {
    await loadSample();
    expect(screen.getByText(/52 × 52 beads/)).toBeTruthy();
    await cropToLeftHalf();
    // Left half of a square image is twice as tall as wide.
    await waitFor(() => expect(screen.getByText(/52 × 104 beads/)).toBeTruthy());
    expect(document.querySelector(".crop-status")!.textContent).toContain("Cropped to");
    fireEvent.click(screen.getByText("Remove crop"));
    await waitFor(() => expect(screen.getByText(/52 × 52 beads/)).toBeTruthy());
    expect(document.querySelector(".crop-status") === null).toBe(true);
  });

  test("the crop can be changed again later", async () => {
    await loadSample();
    await cropToLeftHalf();
    await waitFor(() => expect(screen.getByText(/52 × 104 beads/)).toBeTruthy());
    fireEvent.click(screen.getByText("✂ Crop"));
    // The editor opens on the current crop.
    expect(screen.getByTestId("crop-box").style.width).toBe("50%");
    fireEvent.click(screen.getByText("Reset"));
    fireEvent.click(screen.getByText("Apply crop"));
    await waitFor(() => expect(screen.getByText(/52 × 52 beads/)).toBeTruthy());
  });

  test("Original toggle shows the panel beside the pattern and is remembered", async () => {
    const { unmount } = await loadSample();
    expect(screen.queryByLabelText("Original image") === null).toBe(true);
    fireEvent.click(screen.getByLabelText("Original"));
    expect(screen.getByRole("region", { name: "Original image" })).toBeTruthy();
    expect(document.querySelector(".compare.with-original")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Hide original"));
    expect(screen.queryByRole("region", { name: "Original image" }) === null).toBe(true);
    fireEvent.click(screen.getByLabelText("Original"));
    unmount();
    await loadSample();
    expect(screen.getByRole("region", { name: "Original image" })).toBeTruthy();
  });

  test("Original also shows in fullscreen", async () => {
    await loadSample();
    fireEvent.click(screen.getByLabelText("Original"));
    fireEvent.click(screen.getByText(/Fullscreen/));
    const fs = screen.getByRole("dialog", { name: "Fullscreen pattern" });
    expect(within(fs).getByRole("region", { name: "Original image" })).toBeTruthy();
    // Only one panel at a time (the page's one is hidden behind fullscreen).
    expect(screen.getAllByRole("region", { name: "Original image" })).toHaveLength(1);
  });

  test("the crop is saved with a project and a new image resets it", async () => {
    await loadSample();
    await cropToLeftHalf();
    await waitFor(() => expect(screen.getByText(/52 × 104 beads/)).toBeTruthy());
    fireEvent.click(screen.getByText("Projects"));
    const d = screen.getByRole("dialog", { name: "Projects" });
    fireEvent.change(within(d).getByLabelText("Save this pattern"), { target: { value: "Half" } });
    fireEvent.click(within(d).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(d).getByText("Half")).toBeTruthy());
    expect((await listProjects())[0]!.state.crop).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
    fireEvent.click(within(d).getByLabelText("Close"));

    const bytes = Uint8Array.from(atob(PNG_DATA_URL.split(",")[1]!), (c) => c.charCodeAt(0));
    fireEvent.change(document.querySelector("input[type=file]")!, { target: { files: [new File([bytes], "dog.png", { type: "image/png" })] } });
    await waitFor(() => expect(screen.getByText(/52 × 52 beads/)).toBeTruthy());
    expect(document.querySelector(".crop-status") === null).toBe(true);
  });
});

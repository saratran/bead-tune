import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "../App";
import { DEFAULT_SEARCH_SPACE } from "../lib/auto";
import { allPresets, BUILT_IN_PRESETS, deletePreset, loadLastConfig, savePreset } from "../lib/autoPresets";
import { DEFAULT_PATTERN_OPTIONS } from "../lib/pattern";
import type { PipelineSettings } from "../lib/pipeline";
import { FULL_CROP, imageDataSource, makeImageData } from "../lib/sampling";
import { mockPixels } from "../test/canvas-mock";
import { mard } from "../test/fixtures";
import { AutoDialog, describeCandidate } from "./AutoDialog";

// Red disc on a blue gradient.
const img = makeImageData(48, 48);
for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
  const disc = (x - 24) ** 2 + (y - 24) ** 2 < 11 ** 2;
  img.data.set(disc ? [210, 40, 50, 255] : [30, 60 + y, 120 + x, 255], (y * 48 + x) * 4);
}
const source = imageDataSource(img);
const base: PipelineSettings = { width: 12, sampling: "smooth", denoise: false, trim: false, cleanup: 0, outline: null, crop: FULL_CROP, options: { ...DEFAULT_PATTERN_OPTIONS, palette: mard } };

const count = () => screen.getByTestId("auto-count").textContent!;
const chip = (group: string, name: string) => within(screen.getByRole("group", { name: group })).getByRole("button", { name });

function renderDialog(props: Partial<Parameters<typeof AutoDialog>[0]> = {}) {
  const onResults = mock();
  const onApply = mock();
  const onClose = mock();
  const utils = render(<AutoDialog source={source} base={base} results={null} onResults={onResults} onApply={onApply} onClose={onClose} {...props} />);
  return { ...utils, onResults, onApply, onClose };
}

describe("presets storage", () => {
  test("defaults to the built-in balanced preset", () => {
    expect(loadLastConfig().space).toEqual(DEFAULT_SEARCH_SPACE);
    expect(allPresets().map((p) => p.name)).toEqual(BUILT_IN_PRESETS.map((p) => p.name));
  });

  test("save, replace by name, delete", () => {
    const a = savePreset("Mine", { space: DEFAULT_SEARCH_SPACE, count: 5, limit: 100 });
    savePreset("Mine", { space: { ...DEFAULT_SEARCH_SPACE, maxColors: [8] }, count: 4, limit: 100 });
    const mine = allPresets().filter((p) => !p.builtIn);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.space.maxColors).toEqual([8]);
    deletePreset(mine[0]!.id);
    expect(allPresets().filter((p) => !p.builtIn)).toHaveLength(0);
    expect(a.name).toBe("Mine");
  });

  test("older saved presets get new settings filled in", () => {
    localStorage.setItem("bead-pattern:auto-presets", JSON.stringify([{ id: "user:x", name: "Old", space: { maxColors: [8] } }]));
    const old = allPresets().find((p) => p.name === "Old")!;
    expect(old.space.sampling).toEqual(DEFAULT_SEARCH_SPACE.sampling);
    expect(old.count).toBe(6);
  });
});

describe("AutoDialog", () => {
  test("shows the combination count and updates it as values are toggled", () => {
    renderDialog();
    expect(count()).toStartWith("128 combinations");
    fireEvent.click(chip("Colours", "100"));
    expect(count()).toStartWith("160 combinations");
    fireEvent.click(chip("Sampling", "Sharp"));
    expect(count()).toStartWith("80 combinations");
  });

  test("the last selected value can't be turned off", () => {
    renderDialog();
    fireEvent.click(chip("Sampling", "Sharp"));
    const smooth = chip("Sampling", "Smooth") as HTMLButtonElement;
    expect(smooth.getAttribute("aria-pressed")).toBe("true");
    expect(smooth.disabled).toBe(true);
  });

  test("warns when only an even spread will be tried, and about Accurate being slow", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Try at most"), { target: { value: "100" } });
    expect(count()).toContain("trying an even spread of 100");
    fireEvent.click(chip("Colour matching", "Accurate (slower)"));
    expect(count()).toContain("several times slower");
  });

  test("finds suggestions and applies one", async () => {
    const { onResults, onApply, rerender, onClose } = renderDialog();
    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "builtin:quick" } });
    expect(count()).toStartWith("6 combinations");
    fireEvent.click(screen.getByText("Find suggestions"));
    await waitFor(() => expect(onResults).toHaveBeenCalled(), { timeout: 5000 });
    const list = onResults.mock.lastCall![0];
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].label).toBe("Most faithful");

    rerender(<AutoDialog source={source} base={base} results={list} onResults={onResults} onApply={onApply} onClose={onClose} />);
    expect(screen.getByText("Search again")).toBeTruthy();
    const cards = screen.getAllByRole("listitem");
    expect(within(cards[0]!).getByText("Most faithful")).toBeTruthy();
    expect(within(cards[0]!).getByText(/beads · \d+ stray/)).toBeTruthy();
    fireEvent.click(within(cards[0]!).getByText("Use this"));
    expect(onApply).toHaveBeenCalledWith(list[0]);
  });

  test("Stop ends the scan early", async () => {
    const { onResults } = renderDialog();
    fireEvent.click(screen.getByText("Find suggestions"));
    fireEvent.click(await screen.findByText("Stop"));
    await waitFor(() => expect(screen.getByText(/Find suggestions|Search again/)).toBeTruthy());
    // Either nothing was scored yet or fewer than all 128 were.
    if (onResults.mock.calls.length) expect(onResults.mock.lastCall![0].length).toBeGreaterThan(0);
  });

  test("save and delete a preset from the dialog", () => {
    renderDialog();
    fireEvent.click(chip("Colours", "8"));
    fireEvent.click(screen.getByText("Save preset…"));
    fireEvent.change(screen.getByLabelText("Preset name"), { target: { value: "Cartoons" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((screen.getByLabelText("Preset") as HTMLSelectElement).selectedOptions[0]!.textContent).toBe("Cartoons");
    expect(allPresets().find((p) => p.name === "Cartoons")!.space.maxColors).toContain(8);
    fireEvent.click(screen.getByText("Delete preset"));
    expect(allPresets().some((p) => p.name === "Cartoons")).toBe(false);
  });

  test("remembers the last configuration", () => {
    const { unmount } = renderDialog();
    fireEvent.click(chip("Colours", "100"));
    unmount();
    renderDialog();
    expect(chip("Colours", "100").getAttribute("aria-pressed")).toBe("true");
  });

  test("describeCandidate lists only non-default settings", () => {
    expect(describeCandidate({ sampling: "sharp", denoise: false, maxColors: 24, dither: { mode: "none", strength: 0 }, cleanup: 0, metric: "standard", minBeads: 0, brightness: 0, contrast: 15, saturation: 0 })).toBe(
      "24 colours · Sharp · contrast +15",
    );
  });
});

describe("Auto in the app", () => {
  test("is offered once there's an image, and applying a suggestion changes the settings", async () => {
    mockPixels((w, h) => {
      const d = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(x < w / 2 ? [210, 40, 50, 255] : [40, 90, 200, 255], (y * w + x) * 4);
      return d;
    });
    const { container } = render(<App />);
    expect((screen.getByText("✨ Auto suggestions") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("Try a sample image"));
    await waitFor(() => expect(container.querySelector(".pattern-canvas")).toBeTruthy());
    fireEvent.click(screen.getByText("✨ Auto suggestions"));
    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "builtin:quick" } });
    fireEvent.click(screen.getByText("Find suggestions"));
    const use = await screen.findAllByText("Use this", undefined, { timeout: 8000 });
    fireEvent.click(use[0]!);
    expect(screen.queryByRole("dialog", { name: "Auto suggestions" }) === null).toBe(true);
    expect(document.querySelector(".toast")!.textContent).toBe("Applied “Most faithful”");

    // Reopening shows the same suggestions without rescanning.
    fireEvent.click(screen.getByText("✨ Auto suggestions"));
    expect(screen.getAllByText("Use this").length).toBeGreaterThan(0);
  }, 20000);
});

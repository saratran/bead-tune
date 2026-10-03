import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "../App";
import { DEFAULT_SEARCH_SPACE, SCORE_VERSION } from "../lib/auto";
import {
  allPresets,
  BUILT_IN_PRESETS,
  createPreset,
  DEFAULT_REFINE,
  deletePreset,
  duplicatePreset,
  loadLastConfig,
  renamePreset,
  sameConfig,
  savePreset,
  updatePreset,
} from "../lib/autoPresets";
import { DEFAULT_PATTERN_OPTIONS } from "../lib/pattern";
import type { PipelineSettings } from "../lib/pipeline";
import { FULL_CROP, imageDataSource, makeImageData } from "../lib/sampling";
import { mockPixels } from "../test/canvas-mock";
import { mard } from "../test/fixtures";
import { AutoDialog, describeCandidate, describeChanges, sortBookmarks, sortResults } from "./AutoDialog";

// Red disc on a blue gradient.
const img = makeImageData(48, 48);
for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
  const disc = (x - 24) ** 2 + (y - 24) ** 2 < 11 ** 2;
  img.data.set(disc ? [210, 40, 50, 255] : [30, 60 + y, 120 + x, 255], (y * 48 + x) * 4);
}
const source = imageDataSource(img);
const base: PipelineSettings = { width: 12, sampling: "smooth", denoise: false, trim: false, cleanup: 0, outline: null, crop: FULL_CROP, options: { ...DEFAULT_PATTERN_OPTIONS, palette: mard } };

const count = () => screen.getByTestId("auto-count").textContent!;
const openTab = (name: RegExp) => fireEvent.click(screen.getByRole("tab", { name }));
const chip = (group: string, name: string) => within(screen.getByRole("group", { name: group })).getByRole("button", { name });

function renderDialog(props: Partial<Parameters<typeof AutoDialog>[0]> = {}) {
  const onResults = mock();
  const onApply = mock();
  const onClose = mock();
  const onBookmarksChange = mock();
  const utils = render(<AutoDialog source={source} base={base} results={null} onResults={onResults} onApply={onApply} bookmarks={[]} onBookmarksChange={onBookmarksChange} onClose={onClose} {...props} />);
  return { ...utils, onResults, onApply, onClose, onBookmarksChange };
}

describe("presets storage", () => {
  test("defaults to the built-in balanced preset", () => {
    // Natural + vivid, no dithering or clean-up, 12 suggestions, up to 300 combinations, pattern-search fine-tuning.
    expect(loadLastConfig()).toMatchObject({ space: BUILT_IN_PRESETS[0]!.space, count: 12, limit: 300, tones: ["natural", "vivid"], refine: { enabled: true, method: "pattern", budget: 40 } });
    expect(BUILT_IN_PRESETS[0]!.space).toMatchObject({ dither: [{ mode: "none", strength: 0 }], cleanup: [0], metric: ["accurate"], maxColors: [12, 24, 40, 64] });
    expect(allPresets().map((p) => p.name)).toEqual(BUILT_IN_PRESETS.map((p) => p.name));
  });

  test("saving under a taken name keeps both, with a unique name", () => {
    savePreset("Mine", { space: DEFAULT_SEARCH_SPACE, count: 5, limit: 100, refine: DEFAULT_REFINE, tones: ["natural" as const] });
    savePreset("Mine", { space: { ...DEFAULT_SEARCH_SPACE, maxColors: [8] }, count: 4, limit: 100, refine: DEFAULT_REFINE, tones: ["natural" as const] });
    const mine = allPresets().filter((p) => !p.builtIn);
    expect(mine.map((p) => p.name)).toEqual(["Mine", "Mine (2)"]);
    for (const p of mine) deletePreset(p.id);
    expect(allPresets().filter((p) => !p.builtIn)).toHaveLength(0);
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
    expect(count()).toStartWith("32 combinations × 2 tones");
    fireEvent.click(chip("Colours", "100"));
    expect(count()).toStartWith("40 combinations");
    fireEvent.click(chip("Sampling", "Sharp"));
    expect(count()).toStartWith("20 combinations");
  });

  test("the last selected value can't be turned off", () => {
    renderDialog();
    fireEvent.click(chip("Sampling", "Sharp"));
    const smooth = chip("Sampling", "Smooth") as HTMLButtonElement;
    expect(smooth.getAttribute("aria-pressed")).toBe("true");
    expect(smooth.disabled).toBe(true);
  });

  test("warns when only an even spread will be tried, and when both colour matchings double the time", () => {
    renderDialog();
    fireEvent.click(chip("Colours", "100"));
    fireEvent.click(chip("Dithering", "Diffusion 60%"));
    fireEvent.click(chip("Remove stray beads", "1"));
    fireEvent.change(screen.getByLabelText("Try at most"), { target: { value: "100" } });
    expect(count()).toContain("trying an even spread of 100");
    expect(chip("Colour matching", "Accurate").getAttribute("aria-pressed")).toBe("true"); // the default
    fireEvent.click(chip("Colour matching", "Standard (faster)"));
    expect(count()).toContain("doubles the time");
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

    rerender(<AutoDialog source={source} base={base} results={list} onResults={onResults} onApply={onApply} bookmarks={[]} onBookmarksChange={mock()} onClose={onClose} />);
    // A finished search lands on the Results tab.
    expect(screen.getByRole("tab", { name: /Results/ }).getAttribute("aria-selected")).toBe("true");
    const cards = screen.getAllByRole("listitem");
    expect(within(cards[0]!).getByText("Most faithful")).toBeTruthy();
    expect(within(cards[0]!).getByText(/beads · \d+ stray/)).toBeTruthy();
    fireEvent.click(within(cards[0]!).getByText("Use this"));
    expect(onApply).toHaveBeenCalledWith(list[0]);
    openTab(/Search/);
    expect(screen.getByText("Search again")).toBeTruthy();
  });

  test("Stop ends the scan early", async () => {
    const { onResults } = renderDialog();
    fireEvent.click(screen.getByText("Find suggestions"));
    fireEvent.click(await screen.findByText("Stop"));
    await waitFor(() => expect(screen.queryByText("Stop") === null).toBe(true));
    // Either nothing was scored yet or fewer than all 128 were.
    if (onResults.mock.calls.length) expect(onResults.mock.lastCall![0].length).toBeGreaterThan(0);
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

    // Reopening the results shows the same suggestions without rescanning.
    fireEvent.click(screen.getByRole("button", { name: /^★ Results/ }));
    expect(screen.getAllByText("Use this").length).toBeGreaterThan(0);
  }, 20000);
});

describe("fine-tuning and bookmarks", () => {
  test("fine-tuning settings are part of the remembered configuration", () => {
    const { unmount } = renderDialog();
    expect((screen.getByLabelText("Fine-tune suggestions") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Simulated annealing" }));
    fireEvent.change(screen.getByLabelText("Fine-tuning effort"), { target: { value: "80" } });
    unmount();
    renderDialog();
    expect(screen.getByRole("radio", { name: "Simulated annealing" }).getAttribute("aria-checked")).toBe("true");
    expect((screen.getByLabelText("Fine-tuning effort") as HTMLSelectElement).value).toBe("80");
    fireEvent.click(screen.getByLabelText("Fine-tune suggestions"));
    expect(screen.queryByLabelText("Fine-tuning effort") === null).toBe(true);
  });

  test("describeChanges lists what fine-tuning moved", () => {
    const from = { sampling: "smooth" as const, denoise: false, maxColors: 24, dither: { mode: "diffusion" as const, strength: 60 }, cleanup: 0, metric: "standard" as const, minBeads: 0, brightness: 0, contrast: 0, saturation: 0 };
    expect(describeChanges(from, { ...from, maxColors: 31, brightness: 6, dither: { mode: "diffusion", strength: 45 } })).toBe("31 colours (was 24) · brightness +6 (was 0) · dither 45% (was 60%)");
  });

  test("star a suggestion, then use or remove it from Bookmarks", async () => {
    const { onResults, onApply, rerender, onClose } = renderDialog();
    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "builtin:quick" } });
    fireEvent.click(screen.getByText("Find suggestions"));
    await waitFor(() => expect(onResults).toHaveBeenCalled(), { timeout: 8000 });
    const list = onResults.mock.lastCall![0];
    let bookmarks: import("../lib/bookmarks").Bookmark[] = [];
    const onBookmarksChange = mock((b) => {
      bookmarks = b;
      rerender(<AutoDialog source={source} base={base} results={list} onResults={onResults} onApply={onApply} bookmarks={bookmarks} onBookmarksChange={onBookmarksChange} onClose={onClose} />);
    });
    rerender(<AutoDialog source={source} base={base} results={list} onResults={onResults} onApply={onApply} bookmarks={bookmarks} onBookmarksChange={onBookmarksChange} onClose={onClose} />);

    const star = screen.getByLabelText(`Bookmark ${list[0].label}`);
    expect(star.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(star);
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0]).toMatchObject({ label: list[0].label, candidate: list[0].candidate, context: { width: 12 } });
    expect(bookmarks[0]!.thumbnail).toStartWith("data:image/png");
    expect(screen.getByLabelText(`Remove bookmark: ${list[0].label}`).getAttribute("aria-pressed")).toBe("true");

    const section = screen.getByRole("region", { name: "Bookmarks" });
    expect(within(section).getByText("★ Bookmarks (1)")).toBeTruthy();
    fireEvent.click(within(section).getByText("Use this"));
    expect(onApply).toHaveBeenLastCalledWith(bookmarks[0]);
    fireEvent.click(within(section).getByText("Remove"));
    expect(bookmarks).toEqual([]);
    expect(screen.queryByRole("region", { name: "Bookmarks" }) === null).toBe(true);
  }, 20000);

  test("bookmarks show without running a scan", () => {
    renderDialog({ initialTab: "results", bookmarks: [{ id: "b1", label: "Balanced", candidate: { sampling: "smooth", denoise: false, maxColors: 24, dither: { mode: "none", strength: 0 }, cleanup: 0, metric: "standard", minBeads: 0, brightness: 0, contrast: 0, saturation: 0 }, thumbnail: "data:image/png;base64,AA==", likeness: 80, ease: 60, colors: 24, beads: 144, strays: 2, createdAt: 1, context: { width: 52, brandId: "mard" } }] });
    const section = screen.getByRole("region", { name: "Bookmarks" });
    expect(within(section).getByText("Balanced")).toBeTruthy();
    expect(within(section).getByText("Made at 52 beads wide")).toBeTruthy(); // current width is 12
  });
});

describe("bookmarks in the app", () => {
  const halves = (w: number, h: number) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(x < w / 2 ? [210, 40, 50, 255] : [40, 90, 200, 255], (y * w + x) * 4);
    return d;
  };

  async function loadAndScan() {
    mockPixels(halves);
    const utils = render(<App />);
    fireEvent.click(screen.getByText("Try a sample image"));
    await waitFor(() => expect(utils.container.querySelector(".pattern-canvas")).toBeTruthy());
    fireEvent.click(screen.getByText("✨ Auto suggestions"));
    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "builtin:quick" } });
    return utils;
  }

  test("survive new scans and reloads, and travel with saved projects", async () => {
    const { unmount } = await loadAndScan();
    fireEvent.click(screen.getByText("Find suggestions"));
    const first = (await screen.findAllByLabelText(/^Bookmark /, undefined, { timeout: 10000 }))[0]!;
    const label = first.getAttribute("aria-label")!.replace("Bookmark ", "");
    fireEvent.click(first);
    expect(screen.getByRole("region", { name: "Bookmarks" })).toBeTruthy();

    // A new scan replaces the suggestions but keeps the bookmark.
    openTab(/Search/);
    fireEvent.click(screen.getByText("Search again"));
    await waitFor(() => expect(screen.getByRole("tab", { name: /Results/ }).getAttribute("aria-selected")).toBe("true"), { timeout: 10000 });
    expect(within(screen.getByRole("region", { name: "Bookmarks" })).getByText(label)).toBeTruthy();

    // Reload: same image → same bookmarks.
    unmount();
    await loadAndScan();
    openTab(/Results/);
    expect(within(screen.getByRole("region", { name: "Bookmarks" })).getByText(label)).toBeTruthy();

    // Save as a project, forget the browser's bookmarks, reopen the project.
    fireEvent.click(screen.getByLabelText("Close"));
    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    const d = screen.getByRole("dialog", { name: "Projects" });
    fireEvent.change(within(d).getByLabelText("Save this pattern"), { target: { value: "With bookmark" } });
    fireEvent.click(within(d).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(d).getByText("With bookmark")).toBeTruthy());
    localStorage.removeItem("bead-pattern:bookmarks");
    fireEvent.click(await within(d).findByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Projects" }) === null).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: /^★ Results/ }));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Bookmarks" })).getByText(label)).toBeTruthy());
  }, 40000);
});

describe("tuning from your picks", () => {
  async function withResults() {
    const r = renderDialog();
    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "builtin:quick" } });
    fireEvent.click(screen.getByText("Find suggestions"));
    await waitFor(() => expect(r.onResults).toHaveBeenCalled(), { timeout: 8000 });
    const list = r.onResults.mock.lastCall![0];
    const onResults = mock((l) => r.rerender(<AutoDialog source={source} base={base} results={l} onResults={onResults} onApply={r.onApply} bookmarks={[]} onBookmarksChange={mock()} onClose={r.onClose} />));
    r.rerender(<AutoDialog source={source} base={base} results={list} onResults={onResults} onApply={r.onApply} bookmarks={[]} onBookmarksChange={mock()} onClose={r.onClose} />);
    return { list, onResults };
  }

  test("cards show features, likeness and ease", async () => {
    const { list } = await withResults();
    const card = screen.getAllByRole("listitem")[0]!;
    expect(within(card).getByText(`Features ${list[0].features}`)).toBeTruthy();
    expect(within(card).getByText(`Likeness ${list[0].likeness}`)).toBeTruthy();
    expect(within(card).getByText(`Ease ${list[0].ease}`)).toBeTruthy();
  }, 20000);

  test("prefer a few, then tune them", async () => {
    const { list, onResults } = await withResults();
    fireEvent.click(screen.getByLabelText(`Prefer ${list[0].label}`));
    if (list[1]) fireEvent.click(screen.getByLabelText(`Prefer ${list[1].label}`));
    const bar = screen.getByRole("status");
    expect(bar.textContent).toContain(`${list[1] ? 2 : 1} preferred`);
    fireEvent.click(within(bar).getByText(/Tune selected/));
    await waitFor(() => expect(onResults).toHaveBeenCalled(), { timeout: 15000 });
    expect(screen.getByText("Based on your picks")).toBeTruthy();
    for (const s of onResults.mock.lastCall![0]) expect(s.label).toMatch(/^(Tuned|Simpler|More detail|Variation \d+): /);
    expect(screen.queryByRole("status") === null).toBe(true); // selection cleared
  }, 30000);

  test("More like this tunes a single card", async () => {
    const { list, onResults } = await withResults();
    fireEvent.click(within(screen.getAllByRole("listitem")[0]!).getByText("More like this"));
    await waitFor(() => expect(onResults).toHaveBeenCalled(), { timeout: 15000 });
    expect(onResults.mock.lastCall![0][0].label).toBe(`Tuned: ${list[0].label}`);
  }, 30000);

  test("Clear drops the preferred picks", async () => {
    const { list } = await withResults();
    fireEvent.click(screen.getByLabelText(`Prefer ${list[0].label}`));
    fireEvent.click(within(screen.getByRole("status")).getByText("Clear"));
    expect(screen.queryByRole("status") === null).toBe(true);
    expect((screen.getByLabelText(`Prefer ${list[0].label}`) as HTMLInputElement).checked).toBe(false);
  }, 20000);
});

describe("custom search values", () => {
  test("add a custom brightness, clamped to the allowed range", () => {
    renderDialog();
    const before = Number(count().split(" ")[0]!.replace(/,/g, ""));
    fireEvent.change(screen.getByLabelText("Add brightness value"), { target: { value: "65" } });
    fireEvent.click(screen.getByLabelText("Add brightness"));
    expect(chip("Brightness", "+65").getAttribute("aria-pressed")).toBe("true");
    expect(Number(count().split(" ")[0]!.replace(/,/g, ""))).toBe(before * 2);
    fireEvent.change(screen.getByLabelText("Add saturation value"), { target: { value: "500" } });
    fireEvent.click(screen.getByLabelText("Add saturation"));
    expect(chip("Saturation", "+100").getAttribute("aria-pressed")).toBe("true");
  });

  test("wider default ranges are offered", () => {
    renderDialog();
    expect(chip("Brightness", "-50")).toBeTruthy();
    expect(chip("Contrast", "+70")).toBeTruthy();
    expect(chip("Saturation", "+80")).toBeTruthy();
  });

  test("a custom colour count can be added", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Add colours value"), { target: { value: "30" } });
    fireEvent.click(screen.getByLabelText("Add colours"));
    expect(chip("Colours", "30").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("preset CRUD", () => {
  const cfg = (maxColors: number[]) => ({ space: { ...DEFAULT_SEARCH_SPACE, maxColors }, count: 5, limit: 100, refine: DEFAULT_REFINE, tones: ["natural" as const] });

  test("storage: create, update, rename, duplicate, delete", () => {
    const a = createPreset("Cartoons", cfg([8]));
    expect(createPreset("Cartoons", cfg([12])).name).toBe("Cartoons (2)"); // names stay unique
    expect(updatePreset(a.id, cfg([6, 8])).space.maxColors).toEqual([6, 8]);
    expect(renamePreset(a.id, "Logos").name).toBe("Logos");
    expect(renamePreset(a.id, "Cartoons (2)").name).toBe("Cartoons (2) (2)");
    const copy = duplicatePreset("builtin:photo");
    expect(copy.name).toBe("Photo copy");
    expect(copy.builtIn).toBeFalsy();
    expect(sameConfig(copy, BUILT_IN_PRESETS.find((p) => p.id === "builtin:photo")!)).toBe(true);
    deletePreset(copy.id);
    expect(allPresets().some((p) => p.id === copy.id)).toBe(false);
  });

  test("built-in presets can't be changed", () => {
    expect(() => updatePreset("builtin:quick", cfg([4]))).toThrow("duplicate it first");
    expect(() => renamePreset("builtin:quick", "Mine")).toThrow("duplicate it first");
    expect(savePreset).toBe(createPreset);
  });

  const select = () => screen.getByLabelText("Preset") as HTMLSelectElement;
  const selected = () => select().selectedOptions[0]!.textContent;

  test("create a preset from the current settings", () => {
    renderDialog();
    expect(selected()).toBe("Balanced (default)");
    fireEvent.click(chip("Colours", "8"));
    expect(selected()).toBe("Balanced (default) (modified)");
    expect(screen.getByText(/Built-in presets can't be changed/)).toBeTruthy();
    fireEvent.click(screen.getByText("New preset…"));
    expect((screen.getByLabelText("New preset name") as HTMLInputElement).value).toBe("Balanced (edited)");
    fireEvent.change(screen.getByLabelText("New preset name"), { target: { value: "Cartoons" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(selected()).toBe("Cartoons");
    expect(allPresets().find((p) => p.name === "Cartoons")!.space.maxColors).toContain(8);
  });

  test("edit, save changes, revert, rename and delete your own preset", () => {
    const mine = createPreset("Mine", cfg([12, 24]));
    renderDialog();
    fireEvent.change(select(), { target: { value: mine.id } });
    expect((screen.getByText("Save changes") as HTMLButtonElement).disabled).toBe(true);

    // Update
    fireEvent.click(chip("Colours", "40"));
    expect(selected()).toBe("Mine (modified)");
    fireEvent.click(screen.getByText("Save changes"));
    expect(selected()).toBe("Mine");
    expect(allPresets().find((p) => p.id === mine.id)!.space.maxColors).toEqual([12, 24, 40]);

    // Revert
    fireEvent.click(chip("Colours", "12"));
    fireEvent.click(screen.getByText("Revert"));
    expect(chip("Colours", "12").getAttribute("aria-pressed")).toBe("true");
    expect(selected()).toBe("Mine");

    // Rename
    fireEvent.click(screen.getByText("Rename…"));
    fireEvent.change(screen.getByLabelText("Preset name"), { target: { value: "Portraits" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(selected()).toBe("Portraits");

    // Delete, with confirmation
    fireEvent.click(screen.getByText("Delete…"));
    const confirm = screen.getByRole("group", { name: "Confirm delete" });
    expect(confirm.textContent).toContain("Delete “Portraits”?");
    fireEvent.click(within(confirm).getByText("Keep"));
    expect(allPresets().some((p) => p.id === mine.id)).toBe(true);
    fireEvent.click(screen.getByText("Delete…"));
    fireEvent.click(within(screen.getByRole("group", { name: "Confirm delete" })).getByText("Delete"));
    expect(allPresets().some((p) => p.id === mine.id)).toBe(false);
    expect(selected()).toBe("Custom");
  });

  test("duplicate a built-in to edit it; built-ins have no Save/Rename/Delete", () => {
    renderDialog();
    expect(screen.queryByText("Save changes") === null).toBe(true);
    expect(screen.queryByText("Rename…") === null).toBe(true);
    expect(screen.queryByText("Delete…") === null).toBe(true);
    fireEvent.click(screen.getByText("Duplicate"));
    expect(selected()).toBe("Balanced copy");
    expect(screen.getByText("Rename…")).toBeTruthy();
  });

  test("the selected preset is remembered", () => {
    const { unmount } = renderDialog();
    fireEvent.change(select(), { target: { value: "builtin:photo" } });
    unmount();
    renderDialog();
    expect(selected()).toBe("Photo");
  });
});

describe("colour tone in the panel", () => {
  test("pick tones; each multiplies the work and is remembered", () => {
    const { unmount } = renderDialog();
    // Natural and vivid by default.
    expect(chip("Colour tone", "Natural").getAttribute("aria-pressed")).toBe("true");
    expect(chip("Colour tone", "Vivid").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chip("Colour tone", "Muted"));
    expect(count()).toContain("× 3 tones");
    unmount();
    renderDialog();
    expect(chip("Colour tone", "Muted").getAttribute("aria-pressed")).toBe("true");
  });

  test("tone badges on vivid/muted suggestions and bookmarks", async () => {
    const { onResults, onApply, rerender, onClose } = renderDialog();
    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "builtin:quick" } });
    fireEvent.click(chip("Colour tone", "Natural")); // can't: it's the only one
    fireEvent.click(chip("Colour tone", "Vivid"));
    fireEvent.click(chip("Colour tone", "Natural"));
    fireEvent.click(screen.getByText("Find suggestions"));
    await waitFor(() => expect(onResults).toHaveBeenCalled(), { timeout: 15000 });
    const list = onResults.mock.lastCall![0];
    expect(list.every((s: { tone: string }) => s.tone === "vivid")).toBe(true);
    let bookmarks: import("../lib/bookmarks").Bookmark[] = [];
    const onBookmarksChange = mock((b) => {
      bookmarks = b;
      rerender(<AutoDialog source={source} base={base} results={list} onResults={onResults} onApply={onApply} bookmarks={bookmarks} onBookmarksChange={onBookmarksChange} onClose={onClose} />);
    });
    rerender(<AutoDialog source={source} base={base} results={list} onResults={onResults} onApply={onApply} bookmarks={bookmarks} onBookmarksChange={onBookmarksChange} onClose={onClose} />);
    const card = screen.getAllByRole("listitem")[0]!;
    expect(within(card).getByText("Vivid")).toBeTruthy();
    fireEvent.click(within(card).getByLabelText(/^Bookmark /));
    expect(bookmarks[0]!.tone).toBe("vivid");
    expect(within(screen.getByRole("region", { name: "Bookmarks" })).getByText("Vivid")).toBeTruthy();
  }, 30000);
});

describe("viewing a result large", () => {
  async function withResults(extra: Partial<Parameters<typeof AutoDialog>[0]> = {}) {
    const r = renderDialog();
    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "builtin:quick" } });
    fireEvent.click(screen.getByText("Find suggestions"));
    await waitFor(() => expect(r.onResults).toHaveBeenCalled(), { timeout: 10000 });
    const list = r.onResults.mock.lastCall![0];
    let bookmarks: import("../lib/bookmarks").Bookmark[] = [];
    const props = () => ({ source, base, results: list, onResults: r.onResults, onApply: r.onApply, bookmarks, onClose: r.onClose, ...extra });
    const onBookmarksChange = mock((b) => {
      bookmarks = b;
      r.rerender(<AutoDialog {...props()} onBookmarksChange={onBookmarksChange} />);
    });
    r.rerender(<AutoDialog {...props()} onBookmarksChange={onBookmarksChange} />);
    return { ...r, list, bookmarks: () => bookmarks };
  }
  const viewer = () => screen.getByRole("dialog", { name: /^View / });

  test("click a thumbnail to view it; zoom; browse; Esc closes just the viewer", async () => {
    const { list, onClose } = await withResults();
    fireEvent.click(screen.getByLabelText(`View ${list[0].label} larger`));
    expect(viewer().getAttribute("aria-label")).toBe(`View ${list[0].label}`);
    expect(within(viewer()).getByText(`${list[0].pattern.width} × ${list[0].pattern.height} · ${list[0].pattern.colors.length} colours · ${list[0].pattern.total.toLocaleString()} beads`)).toBeTruthy();
    expect(viewer().querySelector("canvas")).toBeTruthy();

    const level = () => viewer().querySelector('[aria-label="Zoom"] .zoom-level')!.textContent;
    fireEvent.click(within(viewer()).getByLabelText("Zoom in"));
    expect(level()).toBe("125%");
    fireEvent.keyDown(document.body, { key: "+" });
    expect(level()).toBe("156%");
    fireEvent.keyDown(document.body, { key: "0" });
    expect(level()).toBe("100%");

    if (list.length > 1) {
      fireEvent.click(within(viewer()).getByLabelText("Next result"));
      expect(viewer().getAttribute("aria-label")).toBe(`View ${list[1].label}`);
      fireEvent.keyDown(document.body, { key: "ArrowLeft" });
      expect(viewer().getAttribute("aria-label")).toBe(`View ${list[0].label}`);
    }

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /^View / }) === null).toBe(true);
    expect(onClose).not.toHaveBeenCalled(); // the Auto panel stays open
    expect(screen.getByRole("dialog", { name: "Auto suggestions" })).toBeTruthy();
  }, 30000);

  test("use or bookmark from the viewer", async () => {
    const { list, onApply, bookmarks } = await withResults();
    fireEvent.click(screen.getByLabelText(`View ${list[0].label} larger`));
    fireEvent.click(within(viewer()).getByLabelText(`Bookmark ${list[0].label}`));
    expect(bookmarks()).toHaveLength(1);
    expect(within(viewer()).getByLabelText(`Remove bookmark: ${list[0].label}`).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(viewer()).getByText("Use this"));
    expect(onApply).toHaveBeenLastCalledWith(list[0]);
    expect(screen.queryByRole("dialog", { name: /^View / }) === null).toBe(true);
  }, 30000);

  test("compare with the original side by side", async () => {
    const img = new Image();
    Object.defineProperties(img, { naturalWidth: { value: 48 }, naturalHeight: { value: 48 }, width: { value: 48 }, height: { value: 48 } });
    const { list } = await withResults({ image: img });
    fireEvent.click(screen.getByLabelText(`View ${list[0].label} larger`));
    expect(within(viewer()).queryByRole("region", { name: "Original image" }) === null).toBe(true);
    fireEvent.click(within(viewer()).getByLabelText("Original"));
    expect(within(viewer()).getByRole("region", { name: "Original image" })).toBeTruthy();
  }, 30000);

  test("bookmarks can be viewed too (their pattern is rebuilt)", async () => {
    const bm = {
      id: "b1",
      label: "Saved one",
      candidate: { sampling: "smooth" as const, denoise: false, maxColors: 8, dither: { mode: "none" as const, strength: 0 }, cleanup: 0, metric: "standard" as const, minBeads: 0, brightness: 0, contrast: 0, saturation: 0 },
      thumbnail: "data:image/png;base64,AA==",
      likeness: 70,
      ease: 80,
      colors: 8,
      beads: 144,
      strays: 2,
      createdAt: 1,
      context: { width: 12, brandId: "mard" },
    };
    renderDialog({ initialTab: "results", bookmarks: [bm] });
    fireEvent.click(screen.getByLabelText("View Saved one larger"));
    const v = screen.getByRole("dialog", { name: "View Saved one" });
    expect(within(v).getByText(/^12 × 12 · \d+ colours · 144 beads$/)).toBeTruthy();
    expect(within(v).queryByLabelText(/Bookmark/) === null).toBe(true); // already a bookmark
  });
});

describe("sorting", () => {
  const m = (colors: number, beads: number, strays: number) => ({ colorError: 1, detailError: 1, keyDetailError: 1, extremeLoss: 0, subtleLoss: 0, distanceError: 1, edgeError: 0, featureLoss: 0, noise: 0, toneError: 0, colors, beads, strays, fragmentation: 1 });
  const items = [
    { id: "a", features: 60, likeness: 90, ease: 20, metrics: m(40, 300, 9) },
    { id: "b", features: 90, likeness: 70, ease: 50, metrics: m(12, 200, 1) },
    { id: "c", features: 75, likeness: 80, ease: 90, metrics: m(24, 250, 5) },
  ];
  const order = (sort: Parameters<typeof sortResults>[1]) => sortResults(items, sort).map((i) => i.id).join("");

  test("results sort by each option; suggested keeps the order", () => {
    expect(order("suggested")).toBe("abc");
    expect(order("features")).toBe("bca");
    expect(order("likeness")).toBe("acb");
    expect(order("ease")).toBe("cba");
    expect(order("colors-asc")).toBe("bca");
    expect(order("colors-desc")).toBe("acb");
    expect(order("beads")).toBe("bca");
    expect(order("strays")).toBe("bca");
  });

  test("ties keep their original order", () => {
    const tied = [items[0]!, { ...items[1]!, id: "d", features: 60 }];
    expect(sortResults(tied, "features").map((i) => i.id)).toEqual(["a", "d"]);
  });

  test("bookmarks sort by date, scores, colours and name", () => {
    const bm = (label: string, createdAt: number, likeness: number, colors: number) => ({ id: label, label, candidate: {} as never, thumbnail: "", likeness, ease: 50, colors, beads: 1, strays: 0, createdAt, context: { width: 1, brandId: "" } });
    const list = [bm("Crisp", 2, 70, 30), bm("Balanced", 3, 80, 20), bm("Alpha", 1, 90, 10)];
    const names = (sort: Parameters<typeof sortBookmarks>[1]) => sortBookmarks(list, sort).map((b) => b.label);
    expect(names("newest")).toEqual(["Balanced", "Crisp", "Alpha"]);
    expect(names("oldest")).toEqual(["Alpha", "Crisp", "Balanced"]);
    expect(names("likeness")).toEqual(["Alpha", "Balanced", "Crisp"]);
    expect(names("colors-desc")).toEqual(["Crisp", "Balanced", "Alpha"]);
    expect(names("name")).toEqual(["Alpha", "Balanced", "Crisp"]);
  });

  test("the list and the viewer follow the chosen sort, which is remembered", async () => {
    const r = renderDialog();
    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "builtin:quick" } });
    fireEvent.click(screen.getByText("Find suggestions"));
    await waitFor(() => expect(r.onResults).toHaveBeenCalled(), { timeout: 10000 });
    const list = r.onResults.mock.lastCall![0];
    r.rerender(<AutoDialog source={source} base={base} results={list} onResults={r.onResults} onApply={r.onApply} bookmarks={[]} onBookmarksChange={mock()} onClose={r.onClose} />);
    if (list.length < 2) return;
    fireEvent.change(screen.getByLabelText("Sort suggestions"), { target: { value: "colors-asc" } });
    const shown = [...document.querySelectorAll(".auto-results .auto-card .small")].filter((e) => /colours · [\d,]+ beads/.test(e.textContent!)).map((e) => Number(e.textContent!.split(" ")[0]));
    expect(shown).toEqual([...shown].sort((a, b) => a - b));

    const firstLabel = document.querySelector(".auto-results .auto-card strong")!.textContent!;
    fireEvent.click(document.querySelector(".auto-results .thumb-btn")!);
    expect(screen.getByRole("dialog", { name: `View ${firstLabel}` })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });

    r.unmount();
    renderDialog({ results: list, initialTab: "results" });
    expect((screen.getByLabelText("Sort suggestions") as HTMLSelectElement).value).toBe("colors-asc");
  }, 30000);
});

describe("Results tab and bookmarking your own settings", () => {
  const halves = (w: number, h: number) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(x < w / 2 ? [210, 40, 50, 255] : [40, 90, 200, 255], (y * w + x) * 4);
    return d;
  };
  const toast = () => document.querySelector(".toast")?.textContent;

  test("the tabs switch, and an empty Results tab points back to Search", () => {
    renderDialog();
    expect(screen.getByText("Find suggestions")).toBeTruthy();
    openTab(/Results/);
    expect(screen.queryByText("Find suggestions") === null).toBe(true);
    expect(screen.getByText(/No results yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByText("Find suggestions")).toBeTruthy();
  });

  test("the panel's bookmark button reports errors inline", () => {
    const onBookmarkCurrent = mock(() => "These settings are already bookmarked.");
    renderDialog({ initialTab: "results", onBookmarkCurrent });
    fireEvent.click(screen.getByText("★ Bookmark current settings"));
    expect(onBookmarkCurrent).toHaveBeenCalled();
    expect(screen.getByText("These settings are already bookmarked.")).toBeTruthy();
  });

  test("bookmark current settings from the sidebar, then tune it on the Results tab", async () => {
    mockPixels(halves);
    const { container } = render(<App />);
    fireEvent.click(screen.getByText("Try a sample image"));
    await waitFor(() => expect(container.querySelector(".pattern-canvas")).toBeTruthy());

    fireEvent.click(screen.getByText("★ Bookmark current settings"));
    expect(toast()).toBe("Bookmarked “My settings 1”");
    fireEvent.click(screen.getByText("★ Bookmark current settings"));
    expect(toast()).toBe("These settings are already bookmarked.");

    fireEvent.click(screen.getByRole("button", { name: "★ Results (1)" }));
    expect(screen.getByRole("tab", { name: /Results/ }).getAttribute("aria-selected")).toBe("true");
    const section = screen.getByRole("region", { name: "Bookmarks" });
    expect(within(section).getByText("My settings 1")).toBeTruthy();
    expect(within(section).getByText("Your settings")).toBeTruthy();

    fireEvent.click(within(section).getByText("More like this"));
    await waitFor(() => expect(screen.getByText("Based on your picks")).toBeTruthy(), { timeout: 15000 });
    expect(screen.getAllByText(/^Tuned: My settings 1/).length).toBeGreaterThan(0);
  }, 30000);

  test("pixel art settings can't be bookmarked", async () => {
    mockPixels(halves);
    const { container } = render(<App />);
    fireEvent.click(screen.getByText("Try a sample image"));
    await waitFor(() => expect(container.querySelector(".pattern-canvas")).toBeTruthy());
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Sampling" })).getByRole("radio", { name: "Pixel art" }));
    fireEvent.click(screen.getByText("★ Bookmark current settings"));
    expect(toast()).toContain("Pixel art settings can't be bookmarked");
  });
});

describe("scores on one scale", () => {
  test("old bookmarks are re-scored on the image's scale when Results opens", async () => {
    const candidate = { sampling: "smooth" as const, denoise: false, maxColors: 8, dither: { mode: "none" as const, strength: 0 }, cleanup: 0, metric: "standard" as const, minBeads: 0, brightness: 0, contrast: 0, saturation: 0 };
    const old = { id: "b1", label: "Old", candidate, thumbnail: "data:image/png;base64,AA==", likeness: 99, ease: 99, colors: 8, beads: 144, strays: 2, createdAt: 1, context: { width: 12, brandId: "mard" } };
    const { onBookmarksChange } = renderDialog({ initialTab: "results", bookmarks: [old] });
    await waitFor(() => expect(onBookmarksChange).toHaveBeenCalled(), { timeout: 5000 });
    const [updated] = onBookmarksChange.mock.lastCall![0];
    expect(updated.scoreVersion).toBe(SCORE_VERSION);
    expect(updated.likeness).not.toBe(99);
    for (const k of ["features", "likeness", "ease"] as const) {
      expect(updated[k]).toBeGreaterThanOrEqual(0);
      expect(updated[k]).toBeLessThanOrEqual(100);
    }
  });
});

test("re-scoring judges your own settings by the tone their saturation implies", async () => {
  const candidate = { sampling: "smooth" as const, denoise: false, maxColors: 8, dither: { mode: "none" as const, strength: 0 }, cleanup: 0, metric: "accurate" as const, minBeads: 0, brightness: 0, contrast: 4, saturation: 48 };
  const mine = { id: "m1", label: "My settings 1", candidate, thumbnail: "data:image/png;base64,AA==", likeness: 0, ease: 0, colors: 8, beads: 144, strays: 2, createdAt: 1, tone: "natural" as const, fixedScale: true, scoreVersion: 1, context: { width: 12, brandId: "mard" } };
  const { onBookmarksChange } = renderDialog({ initialTab: "results", bookmarks: [mine] });
  await waitFor(() => expect(onBookmarksChange).toHaveBeenCalled(), { timeout: 5000 });
  expect(onBookmarksChange.mock.lastCall![0][0]).toMatchObject({ tone: "vivid", scoreVersion: SCORE_VERSION });
});

test("Auto never removes the background, even when the image settings do", async () => {
  mockPixels((w, h) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(x < w / 2 ? [210, 40, 50, 255] : [255, 255, 255, 255], (y * w + x) * 4);
    return d;
  });
  const { container } = render(<App />);
  fireEvent.click(screen.getByText("Try a sample image"));
  await waitFor(() => expect(container.querySelector(".pattern-canvas")).toBeTruthy());
  fireEvent.click(screen.getByLabelText("Remove background"));
  expect((screen.getByLabelText("Remove background") as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByText("✨ Auto suggestions"));
  fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "builtin:quick" } });
  fireEvent.click(screen.getByText("Find suggestions"));
  const use = await screen.findAllByText("Use this", undefined, { timeout: 8000 });
  // The white half is still in the suggestion (not removed as background).
  expect(document.querySelector(".auto-results .auto-card")!.textContent).toContain("2,704 beads"); // all 52 × 52
  fireEvent.click(use[0]!);
  expect((screen.getByLabelText("Remove background") as HTMLInputElement).checked).toBe(false);
}, 20000);

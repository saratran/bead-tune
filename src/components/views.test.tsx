import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "../App";
import { DEFAULT_EXPORT, type ExportSettings } from "../lib/export";
import { contextOf, mockPixels } from "../test/canvas-mock";
import { checker, makePattern } from "../test/fixtures";
import { ExportDialog } from "./ExportDialog";
import { PatternView } from "./PatternView";

describe("PatternView", () => {
  const pattern = makePattern(["ab", "a."]);
  const props = { pattern, boardSize: 26, showBoards: false, highlightId: null, theme: "dark", shape: "square" as const, codes: false };

  test("draws the pattern sized to the available width", () => {
    const { container } = render(<PatternView {...props} onPickColor={mock()} />);
    const canvas = container.querySelector("canvas")!;
    // 2 beads wide, 26px max cell.
    expect(canvas.style.width).toBe("52px");
    expect(contextOf(canvas).named("fillRect").length).toBeGreaterThan(0);
  });

  test("redraws with codes when toggled on", () => {
    const { container, rerender } = render(<PatternView {...props} onPickColor={mock()} />);
    const ctx = contextOf(container.querySelector("canvas")!);
    expect(ctx.texts()).toEqual([]);
    rerender(<PatternView {...props} codes onPickColor={mock()} />);
    const [a, b] = pattern.colors;
    expect(ctx.texts()).toEqual([a!.code, b!.code, a!.code]);
  });

  test("clicking a bead picks its colour; clicking it again clears", () => {
    const onPick = mock();
    const { container, rerender } = render(<PatternView {...props} onPickColor={onPick} />);
    const canvas = container.querySelector("canvas")!;
    fireEvent.click(canvas, { clientX: 30, clientY: 5 }); // column 2, row 1 → b
    expect(onPick).toHaveBeenLastCalledWith(pattern.colors[1]!.id);

    rerender(<PatternView {...props} highlightId={pattern.colors[1]!.id} onPickColor={onPick} />);
    fireEvent.click(canvas, { clientX: 30, clientY: 5 });
    expect(onPick).toHaveBeenLastCalledWith(null);

    fireEvent.click(canvas, { clientX: 30, clientY: 30 }); // empty peg
    expect(onPick).toHaveBeenLastCalledWith(null);
  });

  test("hover shows position and colour", () => {
    const { container } = render(<PatternView {...props} onPickColor={mock()} />);
    fireEvent.mouseMove(container.querySelector("canvas")!, { clientX: 5, clientY: 30 });
    expect(container.querySelector(".pattern-status")!.textContent).toBe(`Column 1, row 2 · ${pattern.colors[0]!.code}`);
    fireEvent.mouseMove(container.querySelector("canvas")!, { clientX: 30, clientY: 30 });
    expect(container.querySelector(".pattern-status")!.textContent).toBe("Column 2, row 2 · empty peg");
  });
});

describe("ExportDialog", () => {
  const downloads: string[] = [];
  const realClick = HTMLAnchorElement.prototype.click;

  beforeEach(() => {
    downloads.length = 0;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    };
  });
  afterEach(() => {
    HTMLAnchorElement.prototype.click = realClick;
  });

  function setup(overrides: Partial<ExportSettings> = {}, pattern = checker(52)) {
    let settings: ExportSettings = { ...DEFAULT_EXPORT, size: "S", ...overrides };
    const onChange = mock((s: ExportSettings) => {
      settings = s;
      utils.rerender(<ExportDialog pattern={pattern} boardSize={26} baseName="berry" settings={settings} onChange={onChange} onClose={onClose} />);
    });
    const onClose = mock();
    const utils = render(<ExportDialog pattern={pattern} boardSize={26} baseName="berry" settings={settings} onChange={onChange} onClose={onClose} />);
    return { ...utils, onChange, onClose, get settings() { return settings; } };
  }

  test("renders a live preview", async () => {
    const { container } = setup();
    await waitFor(() => expect(container.querySelector(".export-preview canvas")).toBeTruthy());
  });

  test("toggles update settings", () => {
    const s = setup();
    fireEvent.click(screen.getByLabelText("Grid"));
    expect(s.settings.grid).toBe(false);
    fireEvent.click(screen.getByLabelText("Shadow"));
    expect(s.settings.shadow).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Dot" }));
    expect(s.settings.shape).toBe("circle");
    fireEvent.click(screen.getByText("M"));
    expect(s.settings.size).toBe("M");
  });

  test("title and watermark inputs appear only when enabled", () => {
    const s = setup({ title: false, watermark: false });
    expect(screen.queryByPlaceholderText("Pattern name")).toBeNull();
    fireEvent.click(screen.getByLabelText("Title"));
    fireEvent.change(screen.getByPlaceholderText("Pattern name"), { target: { value: "Berry" } });
    expect(s.settings.titleText).toBe("Berry");

    expect(screen.queryByPlaceholderText(/Watermark text/)).toBeNull();
    fireEvent.click(screen.getByLabelText("Watermark"));
    fireEvent.change(screen.getByPlaceholderText(/Watermark text/), { target: { value: "me" } });
    expect(s.settings.watermarkText).toBe("me");
  });

  test("per-pegboard pages are offered only for multi-board PDFs", () => {
    setup({ format: "png" });
    expect(screen.queryByLabelText("One page per pegboard")).toBeNull();
    fireEvent.click(screen.getByText("PDF"));
    expect(screen.getByLabelText("One page per pegboard")).toBeTruthy();
  });

  test("not offered when the pattern fits one board", () => {
    setup({ format: "pdf" }, checker(10));
    expect(screen.queryByLabelText("One page per pegboard")).toBeNull();
  });

  test("download button follows the format and saves the file", async () => {
    setup({ format: "png" });
    fireEvent.click(screen.getByText("Download PNG"));
    await waitFor(() => expect(downloads).toEqual(["berry.png"]));

    fireEvent.click(screen.getByText("PDF"));
    fireEvent.click(screen.getByText("Download PDF"));
    await waitFor(() => expect(downloads).toEqual(["berry.png", "berry.pdf"]));
  });

  test("closes on Escape and the close button", () => {
    const s = setup();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByLabelText("Close"));
    expect(s.onClose).toHaveBeenCalledTimes(2);
  });
});

describe("App", () => {
  const loadSample = async () => {
    mockPixels((w, h) => {
      const d = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) d.set(i % 3 ? [210, 40, 50, 255] : [40, 90, 200, 255], i * 4);
      return d;
    });
    fireEvent.click(screen.getByText("Try a sample image"));
    await waitFor(() => expect(document.querySelector(".pattern-canvas")).toBeTruthy());
  };

  test("starts with the expected defaults", async () => {
    render(<App />);
    // First visit: a welcome in place of the pattern, settings ready.
    expect(screen.getByRole("heading", { name: "Turn any image into a bead pattern" })).toBeTruthy();
    expect((screen.getByLabelText("Beads") as HTMLSelectElement).value).toBe("mard-221");
    expect(screen.getByText("52").className).toBe("on");
    expect((screen.getByText("Export") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByLabelText("Codes") === null).toBe(true); // no view controls until there's a pattern
    expect(document.documentElement.dataset.theme).toBe("dark");

    await loadSample();
    expect(screen.queryByRole("heading", { name: "Turn any image into a bead pattern" }) === null).toBe(true);
    expect((screen.getByLabelText("Board lines") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Codes") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("radio", { name: "Square" }).getAttribute("aria-checked")).toBe("true");
    expect((screen.getByText("Export") as HTMLButtonElement).disabled).toBe(false);
  });

  test("bead sizes only appear in the size choice (it works for any size)", () => {
    const { container } = render(<App />);
    expect(screen.getByRole("radio", { name: "Mini 2.6 mm" }).getAttribute("aria-checked")).toBe("true");
    const rest = container.cloneNode(true) as HTMLElement;
    rest.querySelector('[aria-label="Bead size"]')!.remove();
    expect(rest.textContent).not.toMatch(/\d\s?mm/i);
  });

  test("mixing brands of one size; switching size keeps only brands that come in it", async () => {
    render(<App />);
    fireEvent.click(screen.getByText(/Mix in other brands/));
    fireEvent.click(screen.getByLabelText("Hama Mini (78)"));
    expect(screen.getByText("Mix in other brands (1)")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Midi 5 mm" }));
    expect((screen.getByLabelText("Beads") as HTMLSelectElement).value).toBe("mard-221"); // MARD comes in both sizes
    expect(screen.queryByText(/Mix in other brands \(/) === null).toBe(true); // Hama Mini dropped
    fireEvent.click(screen.getByRole("radio", { name: "Maxi 10 mm" }));
    expect((screen.getByLabelText("Beads") as HTMLSelectElement).value).toBe("hama-maxi");
  });

  test("links to the guide", () => {
    render(<App />);
    expect(screen.getByRole("link", { name: "Guide" }).getAttribute("href")).toBe("./guide.html");
  });

  test("theme toggle switches and remembers light mode", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Light mode"));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("bead-pattern:theme")).toBe("light");
    expect(screen.getByText("Dark mode")).toBeTruthy();
  });

  test("display settings are remembered", async () => {
    const { unmount } = render(<App />);
    await loadSample();
    fireEvent.click(screen.getByLabelText("Codes"));
    fireEvent.click(screen.getByRole("radio", { name: "Bead" }));
    unmount();
    render(<App />);
    await loadSample();
    expect((screen.getByLabelText("Codes") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("radio", { name: "Bead" }).getAttribute("aria-checked")).toBe("true");
  });

  test("width presets and pegboard size update the board summary", async () => {
    render(<App />);
    await act(async () => {
      fireEvent.click(screen.getByText("104"));
    });
    expect(screen.getByText("104").className).toBe("on");
    expect((screen.getByLabelText(/Width/) as HTMLInputElement).value).toBe("104");
  });
});

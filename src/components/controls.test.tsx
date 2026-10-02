import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { mard, makePattern } from "../test/fixtures";
import { BeadList } from "./BeadList";
import { ColorPicker } from "./ColorPicker";
import { Dropzone } from "./Dropzone";
import { ShapePicker } from "./ShapePicker";
import { Toggle } from "./Toggle";

describe("Toggle", () => {
  test("reflects and reports its checked state", () => {
    const onChange = mock();
    render(<Toggle label="Codes" checked={false} onChange={onChange} />);
    const box = screen.getByLabelText("Codes") as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("ShapePicker", () => {
  test("marks the current shape and reports clicks", () => {
    const onChange = mock();
    render(<ShapePicker value="square" onChange={onChange} />);
    expect(screen.getByRole("radio", { name: "Square" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Bead" }).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("radio", { name: "Cross" }));
    expect(onChange).toHaveBeenCalledWith("cross");
  });
});

describe("BeadList", () => {
  const pattern = makePattern(["aab", "a.c"]);
  const [a, b] = pattern.colors;
  const props = { highlightId: null, onHighlight: mock(), onSwap: mock(), onRemove: mock(), canRemove: true };

  test("shows an empty state without a pattern", () => {
    render(<BeadList {...props} pattern={null} />);
    expect(screen.getByText("0 beads · 0 colours")).toBeTruthy();
    expect(screen.getByText(/shopping list shows up here/)).toBeTruthy();
  });

  test("lists colours with counts and a total", () => {
    render(<BeadList {...props} pattern={pattern} />);
    expect(screen.getByText("5 beads · 3 colours")).toBeTruthy();
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector(".bead-count")!.textContent)).toEqual(["3", "1", "1"]);
    expect(rows[0]!.textContent).toContain(a!.code);
  });

  test("formats large counts", () => {
    const big = { ...pattern, counts: [12345, 1, 1], total: 12347 };
    render(<BeadList {...props} pattern={big} />);
    expect(screen.getByText("12,347 beads · 3 colours")).toBeTruthy();
    expect(screen.getByText("12,345")).toBeTruthy();
  });

  test("clicking a colour toggles its highlight", () => {
    const onHighlight = mock();
    const { rerender } = render(<BeadList {...props} pattern={pattern} onHighlight={onHighlight} />);
    fireEvent.click(screen.getAllByRole("listitem")[1]!.querySelector(".bead-row")!);
    expect(onHighlight).toHaveBeenLastCalledWith(b!.id);

    rerender(<BeadList {...props} pattern={pattern} onHighlight={onHighlight} highlightId={b!.id} />);
    expect(screen.getAllByRole("listitem")[1]!.className).toBe("active");
    fireEvent.click(screen.getAllByRole("listitem")[1]!.querySelector(".bead-row")!);
    expect(onHighlight).toHaveBeenLastCalledWith(null);
  });

  test("swap and remove act on the right colour", () => {
    const onSwap = mock();
    const onRemove = mock();
    render(<BeadList {...props} pattern={pattern} onSwap={onSwap} onRemove={onRemove} />);
    fireEvent.click(screen.getAllByTitle("Swap for another colour")[2]!);
    expect(onSwap).toHaveBeenCalledWith(pattern.colors[2]);
    fireEvent.click(screen.getAllByTitle(/Remove colour/)[0]!);
    expect(onRemove).toHaveBeenCalledWith(a);
  });

  test("remove is disabled when only one colour may remain", () => {
    render(<BeadList {...props} pattern={pattern} canRemove={false} />);
    expect(screen.getAllByTitle(/Remove colour/).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });
});

describe("ColorPicker", () => {
  const colors = mard.slice(0, 30);

  test("search filters by code", () => {
    render(<ColorPicker mode="single" title="Swap" colors={colors} onPick={mock()} onClose={mock()} />);
    fireEvent.change(screen.getByPlaceholderText("Search by name or code"), { target: { value: "a1" } });
    const codes = screen.getAllByRole("button", { name: /^A1/ }).map((b) => b.querySelector("b")!.textContent);
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.every((c) => c!.toLowerCase().includes("a1"))).toBe(true);
  });

  test("shows a message when nothing matches", () => {
    render(<ColorPicker mode="single" title="Swap" colors={colors} onPick={mock()} onClose={mock()} />);
    fireEvent.change(screen.getByPlaceholderText("Search by name or code"), { target: { value: "zzz" } });
    expect(screen.getByText(/No colours match/)).toBeTruthy();
  });

  test("single mode picks one colour", () => {
    const onPick = mock();
    render(<ColorPicker mode="single" title="Swap" colors={colors} current={colors[0]!.id} onPick={onPick} onClose={mock()} />);
    fireEvent.click(screen.getByTitle(colors[3]!.code));
    expect(onPick).toHaveBeenCalledWith(colors[3]);
  });

  test("multi mode toggles, selects all and none", () => {
    const onChange = mock();
    const selected = new Set([colors[0]!.id]);
    render(<ColorPicker mode="multi" title="Have" colors={colors} selected={selected} onChange={onChange} onClose={mock()} />);
    expect(screen.getByText("1 selected")).toBeTruthy();

    fireEvent.click(screen.getByTitle(colors[0]!.code));
    expect((onChange.mock.lastCall![0] as Set<string>).size).toBe(0);
    fireEvent.click(screen.getByTitle(colors[1]!.code));
    expect([...(onChange.mock.lastCall![0] as Set<string>)].sort()).toEqual([colors[0]!.id, colors[1]!.id].sort());
    fireEvent.click(screen.getByText("All"));
    expect((onChange.mock.lastCall![0] as Set<string>).size).toBe(30);
    fireEvent.click(screen.getByText("None"));
    expect((onChange.mock.lastCall![0] as Set<string>).size).toBe(0);
  });

  test("closes on Escape, backdrop click and the close button", () => {
    const onClose = mock();
    const { container } = render(<ColorPicker mode="single" title="Swap" colors={colors} onPick={mock()} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(container.querySelector(".modal-backdrop")!);
    fireEvent.click(screen.getByLabelText("Close"));
    fireEvent.click(screen.getByRole("dialog")); // clicks inside don't close
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe("Dropzone", () => {
  const png = () => new File(["x"], "cat.png", { type: "image/png" });
  const txt = () => new File(["x"], "notes.txt", { type: "text/plain" });

  test("accepts an image from the file picker and ignores other files", () => {
    const onFile = mock();
    const { container } = render(<Dropzone onFile={onFile} />);
    const input = container.querySelector("input[type=file]")!;
    fireEvent.change(input, { target: { files: [txt()] } });
    expect(onFile).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { files: [txt(), png()] } });
    expect(onFile).toHaveBeenCalledTimes(1);
    expect((onFile.mock.lastCall![0] as File).name).toBe("cat.png");
  });

  test("accepts a dropped image and shows the drag state", () => {
    const onFile = mock();
    render(<Dropzone onFile={onFile} />);
    const zone = screen.getByRole("button");
    fireEvent.dragOver(zone);
    expect(zone.className).toContain("dragging");
    fireEvent.drop(zone, { dataTransfer: { files: [png()] } });
    expect(zone.className).not.toContain("dragging");
    expect(onFile).toHaveBeenCalledTimes(1);
  });

  test("compact mode is a small change button", () => {
    render(<Dropzone onFile={mock()} compact />);
    expect(screen.getByRole("button").textContent).toBe("Change image");
  });
});

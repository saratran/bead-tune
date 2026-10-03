import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "../App";
import { DEFAULT_IMAGE_SETTINGS } from "./ImageOptions";
import { listProjects, loadProjectImage, saveProject } from "../lib/projects";
import { mockPixels, PNG_DATA_URL } from "../test/canvas-mock";
import { useInMemoryServer } from "../test/server-fetch";

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

const pill = () => screen.getByText(/beads · \d+ colours?$/).textContent;
const cellPx = 400 / 52; // the pattern is fitted into the 600 × 400 test box
const at = (x: number, y: number) => ({ clientX: (x + 0.5) * cellPx, clientY: (y + 0.5) * cellPx, pointerId: 1 });

async function loadSample() {
  mockPixels(redSquare);
  const utils = render(<App />);
  fireEvent.click(screen.getByText("Try a sample image"));
  await waitFor(() => expect(utils.container.querySelector(".pattern-canvas")).toBeTruthy());
  return utils;
}

const dialog = () => screen.getByRole("dialog", { name: "Projects" });
// Slider <output>s also have role "status", so find the toast by class.
const toast = () => document.querySelector(".toast")?.textContent;
const png = () => {
  const bytes = Uint8Array.from(atob(PNG_DATA_URL.split(",")[1]!), (c) => c.charCodeAt(0));
  return new File([bytes], "dog.png", { type: "image/png" });
};

async function saveAs(name: string) {
  fireEvent.click(screen.getByText("Projects"));
  const input = within(dialog()).getByLabelText(/Save this pattern|Current project/);
  fireEvent.change(input, { target: { value: name } });
  fireEvent.click(within(dialog()).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(within(dialog()).getByText(name)).toBeTruthy());
}

describe("projects in the app", () => {
  test("the dialog explains that an image is needed first", async () => {
    render(<App />);
    fireEvent.click(screen.getByText("Projects"));
    expect(within(dialog()).getByText(/Add an image first/)).toBeTruthy();
    expect((within(dialog()).getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(within(dialog()).getByText("No saved projects yet.")).toBeTruthy());
    expect((screen.getAllByText("Save")[0] as HTMLButtonElement).disabled).toBe(true); // topbar Save
  });

  test("save names the project, defaulting to the image name", async () => {
    await loadSample();
    fireEvent.click(screen.getByText("Projects"));
    expect((within(dialog()).getByLabelText("Save this pattern") as HTMLInputElement).value).toBe("sample");
    fireEvent.change(within(dialog()).getByLabelText("Save this pattern"), { target: { value: "Berry" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(dialog()).getByText("Berry")).toBeTruthy());
    expect(toast()).toBe("Saved “Berry”");
    expect(within(dialog()).getByText(/52 beads wide/)).toBeTruthy();
    const [saved] = await listProjects();
    expect(saved).toMatchObject({ name: "Berry", imageName: "sample" });
    expect(saved!.thumbnail).toStartWith("data:image/png");
  });

  test("shows unsaved changes and saves them in place", async () => {
    await loadSample();
    await saveAs("Berry");
    fireEvent.click(within(dialog()).getByLabelText("Close"));
    expect(screen.queryByLabelText("Unsaved changes") === null).toBe(true);

    fireEvent.click(screen.getByLabelText("Remove background"));
    await waitFor(() => expect(screen.getByLabelText("Unsaved changes")).toBeTruthy());

    fireEvent.click(screen.getAllByText("Save")[0]!); // topbar quick save
    await waitFor(() => expect(screen.queryByLabelText("Unsaved changes") === null).toBe(true));
    const all = await listProjects();
    expect(all).toHaveLength(1);
    expect(all[0]!.state.image.removeBackground).toBe(true);
  });

  test("Ctrl/⌘+S saves the open project", async () => {
    await loadSample();
    await saveAs("Berry");
    fireEvent.click(within(dialog()).getByLabelText("Close"));
    fireEvent.click(screen.getByText("78"));
    await waitFor(() => expect(screen.getByLabelText("Unsaved changes")).toBeTruthy());
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => expect(screen.queryByLabelText("Unsaved changes") === null).toBe(true));
    expect((await listProjects())[0]!.state.width).toBe(78);
  });

  test("Ctrl/⌘+S without a project opens the save dialog", async () => {
    await loadSample();
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(dialog()).toBeTruthy();
  });

  test("opening a project restores its settings, colour edits and hand edits", async () => {
    const { container } = await loadSample();
    // Settings + a hand edit.
    fireEvent.click(screen.getByRole("radio", { name: "Sharp" }));
    fireEvent.click(screen.getByText("Edit beads"));
    fireEvent.click(screen.getByRole("radio", { name: "Erase" }));
    const canvas = container.querySelector(".pattern-canvas")!;
    fireEvent.pointerDown(canvas, at(0, 0));
    fireEvent.pointerUp(canvas, at(0, 0));
    await waitFor(() => expect(pill()).toBe("2,703 beads · 2 colours"));
    fireEvent.click(screen.getByText("Done editing"));
    await saveAs("Berry");
    fireEvent.click(within(dialog()).getByLabelText("Close"));

    // Start over with different settings (confirming the hand-edit warning once).
    fireEvent.click(screen.getByRole("radio", { name: "Smooth" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Hand edits may be lost" })).getByText("Change anyway"));
    fireEvent.click(screen.getByText("104")); // not asked again until the next stroke
    await waitFor(() => expect(screen.queryByText(/edited by hand/) === null).toBe(true));

    // Open it again.
    fireEvent.click(screen.getByText("Projects"));
    fireEvent.click(await within(dialog()).findByRole("button", { name: "Open" }));
    // The project has unsaved changes (Smooth, width 104), so we're asked first.
    const prompt = await screen.findByRole("alertdialog", { name: "Unsaved changes" });
    fireEvent.click(within(prompt).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.queryByRole("dialog") === null).toBe(true));
    await waitFor(() => expect(pill()).toBe("2,703 beads · 2 colours"));
    expect(screen.getByRole("radio", { name: "Sharp" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("52").className).toBe("on");
    expect(screen.getByText("1 bead edited by hand")).toBeTruthy();
    expect(toast()).toBe("Opened “Berry”");
    await waitFor(() => expect(screen.queryByLabelText("Unsaved changes") === null).toBe(true));
    expect(screen.getByTitle("Saved").textContent).toBe("Berry");
  });

  test("an older project with the outline switched on opens with its outline drawn in as edits", async () => {
    mockPixels(redSquare);
    const { edgeMargin: _, ...image } = DEFAULT_IMAGE_SETTINGS;
    await saveProject({
      name: "Old outline",
      image: png(),
      imageName: "dog.png",
      thumbnail: PNG_DATA_URL,
      state: {
        version: 1,
        brandId: "mard-221",
        width: 52,
        boardSize: 26,
        image: { ...image, removeBackground: true, outline: true } as never,
        outlineId: null,
        ownedOnly: false,
        excluded: [],
        swaps: [],
        edits: { w: 0, h: 0, cells: [] },
      },
    });
    render(<App />);
    fireEvent.click(screen.getByText("Projects"));
    fireEvent.click(await within(dialog()).findByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.getByText(/beads edited by hand/)).toBeTruthy());
    expect(pill()).toMatch(/· 2 colours$/);
    fireEvent.click(screen.getByText("Edit beads"));
    expect((screen.getByLabelText("Edge margin") as HTMLInputElement).checked).toBe(true);
    // The same 52 × 52 grid as before: a 50-bead image plus the margin.
    expect((screen.getByLabelText(/^Width/) as HTMLInputElement).value).toBe("50");
    expect(document.querySelector(".pattern-size")!.textContent).toBe("52 × 52 beads");
  });

  test("versions are grouped, and projects can be searched", async () => {
    await loadSample();
    await saveAs("Berry");
    const saveVersion = async (name: string) => {
      fireEvent.change(within(dialog()).getByLabelText("Current project"), { target: { value: name } });
      fireEvent.click(within(dialog()).getByRole("button", { name: "Save as new version" }));
      await waitFor(() => expect(within(dialog()).getByText(name)).toBeTruthy());
    };
    await saveVersion("Berry v2");
    await saveVersion("Apple pie with a very long name that would not fit");

    const local = () => within(dialog()).getByRole("region", { name: "On this device" });
    expect(within(local()).getByText("Berry v2")).toBeTruthy();
    expect(within(local()).queryByText("Berry") === null).toBe(true); // tucked under v2
    fireEvent.click(within(local()).getByRole("button", { name: /1 older version/ }));
    expect(within(local()).getByText("Berry")).toBeTruthy();
    // Long names are shown in full (and on hover).
    expect(within(local()).getByTitle("Apple pie with a very long name that would not fit")).toBeTruthy();

    fireEvent.change(within(dialog()).getByLabelText("Search projects"), { target: { value: "aple" } });
    expect(within(local()).getByText(/^Apple pie/)).toBeTruthy();
    expect(within(local()).queryByText("Berry v2") === null).toBe(true);
    fireEvent.change(within(dialog()).getByLabelText("Search projects"), { target: { value: "bery" } });
    expect(within(local()).getByText("Berry v2")).toBeTruthy();
    expect(within(local()).getByText("Berry")).toBeTruthy(); // matching versions all show while searching
    fireEvent.change(within(dialog()).getByLabelText("Search projects"), { target: { value: "zzz" } });
    expect(within(local()).getByText("No projects match “zzz”.")).toBeTruthy();
  });

  test("the project name in the top bar opens Projects and shows the full name on hover", async () => {
    await loadSample();
    await saveAs("A rather long project name for the top bar");
    fireEvent.click(within(dialog()).getByLabelText("Close"));
    fireEvent.click(screen.getByTitle("Saved"));
    expect(dialog()).toBeTruthy();
    expect(screen.getAllByTitle("A rather long project name for the top bar").length).toBeGreaterThan(0);
  });

  test("build progress is saved with the project", async () => {
    await loadSample();
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Build mode" })).getByText("✓ Board done"));
    fireEvent.click(screen.getByLabelText("Close build mode"));
    await saveAs("Half built");
    fireEvent.click(within(dialog()).getByLabelText("Close"));
    // Clear it (Reset), then reopen the saved project: the progress comes back.
    fireEvent.click(screen.getByRole("button", { name: "Build · 25%" }));
    const build = screen.getByRole("dialog", { name: "Build mode" });
    fireEvent.click(within(build).getByRole("button", { name: "Reset" }));
    fireEvent.click(within(build).getByRole("button", { name: "Reset" })); // confirm
    fireEvent.click(screen.getByLabelText("Close build mode"));
    expect(screen.getByRole("button", { name: "Build" })).toBeTruthy();
    fireEvent.click(screen.getByText("Projects"));
    fireEvent.click(await within(dialog()).findByRole("button", { name: "Open" }));
    const prompt = await screen.findByRole("alertdialog", { name: "Unsaved changes" });
    fireEvent.click(within(prompt).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Build · 25%" })).toBeTruthy());
  });

  test("a new image starts a new unsaved project", async () => {
    await loadSample();
    await saveAs("Berry");
    fireEvent.click(within(dialog()).getByLabelText("Close"));
    expect(screen.getByTitle("Saved")).toBeTruthy();
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [png()] } });
    await waitFor(() => expect(screen.queryByTitle("Saved") === null).toBe(true));
    expect(screen.queryByTitle("Unsaved changes") === null).toBe(true);
  });

  test("save as new version keeps the original", async () => {
    await loadSample();
    await saveAs("Berry");
    fireEvent.change(within(dialog()).getByLabelText("Current project"), { target: { value: "Berry 2" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Save as new version" }));
    await waitFor(() => expect(within(dialog()).getByText("Berry 2")).toBeTruthy());
    expect((await listProjects()).map((p) => p.name).sort()).toEqual(["Berry", "Berry 2"]);
    expect(screen.getByTitle("Saved").textContent).toBe("Berry 2");
  });

  test("rename and delete from the list", async () => {
    await loadSample();
    await saveAs("Berry");
    const list = () => dialog().querySelector(".project-list")!;

    fireEvent.click(within(list() as HTMLElement).getByRole("button", { name: "Rename" }));
    fireEvent.change(within(dialog()).getByLabelText("New name"), { target: { value: "Strawberry" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(within(list() as HTMLElement).getByText("Strawberry")).toBeTruthy());
    expect(screen.getByTitle("Saved").textContent).toBe("Strawberry"); // open project renamed too

    fireEvent.click(within(list() as HTMLElement).getByRole("button", { name: "Delete" }));
    expect(within(dialog()).getByText("Delete?")).toBeTruthy();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Keep" }));
    expect(within(dialog()).queryByText("Delete?") === null).toBe(true);

    fireEvent.click(within(list() as HTMLElement).getByRole("button", { name: "Delete" }));
    fireEvent.click(within(list() as HTMLElement).getAllByRole("button", { name: "Delete" })[0]!);
    await waitFor(() => expect(within(dialog()).getByText("No saved projects yet.")).toBeTruthy());
    expect(screen.queryByTitle("Saved") === null).toBe(true); // no longer an open project
    expect(await listProjects()).toEqual([]);
  });

  test("exports are named after the project", async () => {
    await loadSample();
    await saveAs("Berry");
    fireEvent.click(within(dialog()).getByLabelText("Close"));
    const downloads: string[] = [];
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    };
    try {
      fireEvent.click(screen.getByText("Export"));
      fireEvent.click(screen.getByText(/^Download /));
      await waitFor(() => expect(downloads[0]).toStartWith("Berry-bead-pattern."));
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
    }
  });
});

describe("saving robustness", () => {
  test("a picked photo that later becomes unreadable (Android) can still be saved", async () => {
    mockPixels(redSquare);
    render(<App />);
    const file = png();
    // Like a Google Photos pick on Android: readable when picked, but access is
    // revoked a little later — before the user gets round to saving.
    let revoked = false;
    const notReadable = () => Promise.reject(new DOMException("The requested file could not be read", "NotReadableError"));
    Object.defineProperty(file, "arrayBuffer", { value: () => (revoked ? notReadable() : Blob.prototype.arrayBuffer.call(file)) });
    fireEvent.change(document.querySelector("input[type=file]")!, { target: { files: [file] } });
    await waitFor(() => expect(document.querySelector(".pattern-canvas")).toBeTruthy());
    revoked = true;

    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast()).toBe("Saved “dog”"));
    expect(dialog().querySelector(".error")).toBeNull();
    // The stored image is the photo's bytes.
    const blob = await loadProjectImage((await listProjects())[0]!.id);
    expect(blob!.size).toBe(file.size);
  });

  test("a failed quick save shows a visible error", async () => {
    await loadSample();
    await saveAs("Berry");
    fireEvent.click(within(dialog()).getByLabelText("Close"));
    fireEvent.click(screen.getByText("78"));
    // Storage goes away (e.g. blocked by the browser).
    const saved = globalThis.indexedDB;
    (globalThis as { indexedDB?: unknown }).indexedDB = undefined;
    try {
      fireEvent.click(screen.getAllByText("Save")[0]!);
      await waitFor(() => expect(document.querySelector(".toast-error")?.textContent).toBe("Couldn't save: This browser can't store projects."));
      expect(screen.getByRole("alert")).toBeTruthy();
    } finally {
      globalThis.indexedDB = saved;
    }
  });
});

describe("server projects and versions", () => {
  let api: ReturnType<typeof useInMemoryServer> | null = null;
  afterEach(() => {
    api?.close();
    api = null;
  });

  const target = (name: "This device" | "Server") => within(dialog()).getByRole("radio", { name });

  test("without a server, there's no choice of where to save (it's this browser)", async () => {
    await loadSample();
    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    await waitFor(() => expect(within(dialog()).getByRole("region", { name: "On this device" })).toBeTruthy());
    await new Promise((r) => setTimeout(r, 20)); // let the server check finish
    expect(within(dialog()).queryByRole("radiogroup", { name: "Save to" }) === null).toBe(true);
    expect(within(dialog()).queryByRole("region", { name: "On the server" }) === null).toBe(true);
    expect(within(dialog()).getByText("Saved in this browser only.")).toBeTruthy();
  });

  test("save to the server, then reopen it from the list", async () => {
    api = useInMemoryServer();
    await loadSample();
    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    await waitFor(() => expect(target("Server")).toBeTruthy());
    fireEvent.click(target("Server"));
    fireEvent.change(within(dialog()).getByLabelText("Save this pattern"), { target: { value: "Shared berry" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast()).toBe("Saved “Shared berry” to the server"));
    const onServer = within(dialog()).getByRole("region", { name: "On the server" });
    await waitFor(() => expect(within(onServer).getByText("Shared berry")).toBeTruthy());
    expect(await listProjects()).toEqual([]); // nothing on this device
    expect(screen.getByLabelText("Stored on the server")).toBeTruthy(); // topbar badge

    // Change something and quick-save: goes back to the server copy.
    fireEvent.click(within(dialog()).getByLabelText("Close"));
    fireEvent.click(screen.getByText("78"));
    fireEvent.click(screen.getAllByText("Save")[0]!);
    await waitFor(() => expect(toast()).toBe("Saved “Shared berry” to the server"));
    const server = await (await fetch("/api/projects")).json();
    expect(server).toHaveLength(1);
    expect(server[0].state.width).toBe(78);
  });

  test("Save as… suggests the next version and keeps the original", async () => {
    await loadSample();
    await saveAs("Berry");
    fireEvent.click(within(dialog()).getByLabelText("Close"));
    fireEvent.click(screen.getByText("Save as…"));
    expect(within(dialog()).getByRole("heading", { name: "Save as new version" })).toBeTruthy();
    await waitFor(() => expect((within(dialog()).getByLabelText("New version name") as HTMLInputElement).value).toBe("Berry v2"));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Save as new version" }));
    await waitFor(() => expect(toast()).toBe("Saved “Berry v2”"));
    expect((await listProjects()).map((p) => p.name).sort()).toEqual(["Berry", "Berry v2"]);
    expect(screen.getByTitle("Saved").textContent).toBe("Berry v2");
  });

  test("Save as… is only offered once a project is open", async () => {
    await loadSample();
    expect((screen.getByText("Save as…") as HTMLButtonElement).disabled).toBe(true);
  });

  test("copy a project from this device to the server and back", async () => {
    api = useInMemoryServer();
    await loadSample();
    await saveAs("Berry");
    const onDevice = within(dialog()).getByRole("region", { name: "On this device" });
    fireEvent.click(await within(onDevice).findByRole("button", { name: "Copy to server" }));
    const onServer = () => within(dialog()).getByRole("region", { name: "On the server" });
    await waitFor(() => expect(within(onServer()).getByText("Berry")).toBeTruthy());
    const server = await (await fetch("/api/projects")).json();
    expect(server[0].name).toBe("Berry");

    fireEvent.click(within(onServer()).getByRole("button", { name: "Copy to device" }));
    await waitFor(async () => expect(await listProjects()).toHaveLength(2));
  });
});

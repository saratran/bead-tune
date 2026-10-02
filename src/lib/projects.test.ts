import { describe, expect, test } from "bun:test";
import { DEFAULT_IMAGE_SETTINGS } from "../components/ImageOptions";
import { deleteProject, listProjects, loadProjectImage, renameProject, saveProject, type ProjectState } from "./projects";

const state: ProjectState = {
  version: 1,
  brandId: "mard-221",
  width: 52,
  boardSize: 26,
  image: { ...DEFAULT_IMAGE_SETTINGS, sampling: "sharp", bgColor: [1, 2, 3] },
  outlineId: "mard:H7",
  ownedOnly: false,
  excluded: ["mard:A1"],
  swaps: [["mard:B2", "mard:C3"]],
  edits: { w: 52, h: 52, cells: [[0, null], [5, "mard:A2"]] },
};
const image = () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" });
const input = (name: string) => ({ name, image: image(), imageName: "cat", thumbnail: "data:image/png;base64,AA==", state });

describe("projects storage", () => {
  test("starts empty", async () => {
    expect(await listProjects()).toEqual([]);
  });

  test("saves and lists a project with its full state", async () => {
    const saved = await saveProject(input("Cat"));
    expect(saved.id).toBeTruthy();
    const [listed] = await listProjects();
    expect(listed).toEqual(saved);
    expect(listed!.state).toEqual(state);
    expect(listed!.createdAt).toBe(listed!.updatedAt);
  });

  test("keeps the image in a separate store", async () => {
    const saved = await saveProject(input("Cat"));
    const blob = await loadProjectImage(saved.id);
    expect(blob).toBeDefined();
    expect([...new Uint8Array(await blob!.arrayBuffer())]).toEqual([1, 2, 3, 4]);
    expect(await loadProjectImage("missing")).toBeUndefined();
  });

  test("saving with an id overwrites and keeps the creation time", async () => {
    const first = await saveProject(input("Cat"));
    await new Promise((r) => setTimeout(r, 5));
    const second = await saveProject({ ...input("Cat v2"), id: first.id, state: { ...state, width: 78 } });
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
    const all = await listProjects();
    expect(all).toHaveLength(1);
    expect(all[0]!.state.width).toBe(78);
  });

  test("lists most recently saved first", async () => {
    await saveProject(input("Old"));
    await new Promise((r) => setTimeout(r, 5));
    await saveProject(input("New"));
    expect((await listProjects()).map((p) => p.name)).toEqual(["New", "Old"]);
  });

  test("blank names become Untitled; names are trimmed", async () => {
    expect((await saveProject(input("   "))).name).toBe("Untitled");
    expect((await saveProject(input("  Dog  "))).name).toBe("Dog");
  });

  test("rename changes only the name (blank keeps the old one)", async () => {
    const saved = await saveProject(input("Cat"));
    await renameProject(saved.id, "Kitten");
    expect((await listProjects())[0]!.name).toBe("Kitten");
    await renameProject(saved.id, "  ");
    expect((await listProjects())[0]!.name).toBe("Kitten");
    expect((await listProjects())[0]!.state).toEqual(state);
    expect(renameProject("missing", "x")).rejects.toThrow("no longer exists");
  });

  test("delete removes the project and its image", async () => {
    const a = await saveProject(input("A"));
    const b = await saveProject(input("B"));
    await deleteProject(a.id);
    expect((await listProjects()).map((p) => p.id)).toEqual([b.id]);
    expect(await loadProjectImage(a.id)).toBeUndefined();
  });
});

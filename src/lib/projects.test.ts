import { describe, expect, test } from "bun:test";
import { DEFAULT_IMAGE_SETTINGS } from "../components/ImageOptions";
import { deleteProject, fuzzyScore, groupVersions, listProjects, loadProjectImage, nextVersionName, versionBase, renameProject, saveProject, type ProjectState } from "./projects";

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

describe("nextVersionName", () => {
  test("adds or bumps a version number", () => {
    expect(nextVersionName("Berry", [])).toBe("Berry v2");
    expect(nextVersionName("Berry v2", ["Berry", "Berry v2"])).toBe("Berry v3");
  });

  test("skips versions that already exist", () => {
    expect(nextVersionName("Berry", ["Berry", "Berry v2", "Berry v5", "Other v9"])).toBe("Berry v6");
  });

  test("blank names", () => {
    expect(nextVersionName("  ", [])).toBe("Untitled v2");
  });
});

describe("versions and search", () => {
  const meta = (name: string, updatedAt: number) => ({ id: name, name, updatedAt }) as unknown as import("./projects").ProjectMeta;

  test("versionBase strips the version suffix", () => {
    expect(versionBase("Berry v12")).toBe("Berry");
    expect(versionBase("Berry")).toBe("Berry");
    expect(versionBase("v2")).toBe("v2");
  });

  test("groupVersions puts versions together, newest first", () => {
    const groups = groupVersions([meta("Berry", 1), meta("Apple", 5), meta("Berry v3", 4), meta("berry v2", 2)]);
    expect(groups.map((g) => g.map((p) => p.name))).toEqual([["Apple"], ["Berry v3", "berry v2", "Berry"]]);
  });

  test("fuzzyScore matches letters in order and prefers closer matches", () => {
    expect(fuzzyScore("bry", "Strawberry")).not.toBeNull();
    expect(fuzzyScore("yrb", "Strawberry")).toBeNull();
    expect(fuzzyScore("straw cat", "Strawberry cat")).not.toBeNull();
    expect(fuzzyScore("straw dog", "Strawberry cat")).toBeNull();
    expect(fuzzyScore("berry", "Berry v2")!).toBeGreaterThan(fuzzyScore("berry", "Big errand by Ray")!);
    expect(fuzzyScore("", "anything")).toBe(0);
  });
});

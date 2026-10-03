import { describe, expect, test } from "bun:test";
import { DEFAULT_IMAGE_SETTINGS } from "../components/ImageOptions";
import { parseProjectFile, projectFileName, toProjectFile } from "./projectFile";
import type { ProjectState } from "./projects";

const state: ProjectState = {
  version: 1,
  brandId: "mard-221",
  width: 52,
  boardSize: 26,
  image: DEFAULT_IMAGE_SETTINGS,
  outlineId: null,
  ownedOnly: false,
  excluded: [],
  swaps: [],
  edits: { w: 52, h: 52, cells: [[3, "mard:A1"], [4, null]] },
  build: { w: 52, h: 52, placed: [1, 2, 3] },
};

describe("project files", () => {
  test("round trip keeps the image bytes and every setting", async () => {
    const bytes = new Uint8Array(70_000).map((_, i) => (i * 31) % 256); // bigger than one base64 chunk
    const file = await toProjectFile({ name: "Berry v2", imageName: "berry.png", thumbnail: "data:image/png;base64,AA==", state, image: new Blob([bytes], { type: "image/png" }) });
    const back = await parseProjectFile(file);
    expect(back).toMatchObject({ name: "Berry v2", imageName: "berry.png", thumbnail: "data:image/png;base64,AA==", state });
    expect(back.image.type).toBe("image/png");
    expect(new Uint8Array(await back.image.arrayBuffer())).toEqual(bytes);
  });

  test("anything else is refused with a readable message", async () => {
    await expect(parseProjectFile(new Blob(["not json"]))).rejects.toThrow("isn't a BeadTune project file");
    await expect(parseProjectFile(new Blob([JSON.stringify({ hello: 1 })]))).rejects.toThrow("isn't a BeadTune project file");
    await expect(parseProjectFile(new Blob([JSON.stringify({ format: "beadtune-project", version: 99 })]))).rejects.toThrow("newer version");
    await expect(parseProjectFile(new Blob([JSON.stringify({ format: "beadtune-project", version: 1, name: "x" })]))).rejects.toThrow("incomplete");
  });

  test("file names are safe and end in .beadtune", () => {
    expect(projectFileName("Berry v2")).toBe("Berry v2.beadtune");
    expect(projectFileName('a/b:c*d?"e')).toBe("a-b-c-d-e.beadtune");
    expect(projectFileName("   ")).toBe("project.beadtune");
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_IMAGE_SETTINGS } from "../components/ImageOptions";
import { useInMemoryServer } from "../test/server-fetch";
import type { ProjectState } from "./projects";
import { localStore, serverAvailable, serverStore, storeFor } from "./projectStores";

const state: ProjectState = { version: 1, brandId: "mard-221", width: 52, boardSize: 26, image: DEFAULT_IMAGE_SETTINGS, outlineId: null, ownedOnly: false, excluded: [], swaps: [], edits: { w: 0, h: 0, cells: [] } };
const input = (name: string) => ({ name, image: new Blob([new Uint8Array([1, 2, 3, 250])], { type: "image/png" }), imageName: "cat", thumbnail: "data:image/png;base64,AA==", state });

let api: ReturnType<typeof useInMemoryServer> | null = null;
afterEach(() => {
  api?.close();
  api = null;
});

describe("serverStore", () => {
  test("isn't available without a server", async () => {
    expect(await serverAvailable()).toBe(false);
  });

  test("round-trips projects through the API", async () => {
    api = useInMemoryServer();
    expect(await serverAvailable()).toBe(true);
    const store = serverStore();
    const saved = await store.save(input("Cat"));
    expect(saved).toMatchObject({ name: "Cat", location: "server", state });
    const [listed] = await store.list();
    expect(listed).toMatchObject({ id: saved.id, location: "server" });

    const blob = await store.loadImage(saved.id);
    expect([...new Uint8Array(await blob!.arrayBuffer())]).toEqual([1, 2, 3, 250]);
    expect(blob!.type).toBe("image/png");

    await store.rename(saved.id, "Kitten");
    expect((await store.list())[0]!.name).toBe("Kitten");
    const again = await store.save({ ...input("Kitten"), id: saved.id, state: { ...state, width: 78 } });
    expect(again.id).toBe(saved.id);
    expect((await store.list())).toHaveLength(1);

    await store.remove(saved.id);
    expect(await store.list()).toEqual([]);
    expect(await store.loadImage(saved.id)).toBeUndefined();
  });

  test("server errors become readable messages", async () => {
    api = useInMemoryServer();
    expect(serverStore().rename("missing", "x")).rejects.toThrow("That project no longer exists.");
  });

  test("large images survive base64 encoding", async () => {
    api = useInMemoryServer();
    const big = new Uint8Array(300_000).map((_, i) => (i * 7) % 256);
    const saved = await serverStore().save({ ...input("Big"), image: new Blob([big], { type: "image/jpeg" }) });
    const back = new Uint8Array(await (await serverStore().loadImage(saved.id))!.arrayBuffer());
    expect(back.length).toBe(big.length);
    expect(back.every((v, i) => v === big[i])).toBe(true);
  });
});

test("storeFor picks the store by location; local projects are tagged", async () => {
  expect(storeFor("server").location).toBe("server");
  expect(storeFor(undefined)).toBe(localStore);
  expect((await localStore.save(input("Here"))).location).toBe("local");
});

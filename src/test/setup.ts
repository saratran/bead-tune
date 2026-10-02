import { afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";

GlobalRegistrator.register({ url: "http://localhost:3000/" });

// Imported after registration so they see the DOM globals.
const { cleanup } = await import("@testing-library/react");
const { installCanvasMock, mockPixels } = await import("./canvas-mock");

installCanvasMock();

afterEach(() => {
  cleanup();
  mockPixels(null);
  localStorage.clear();
  // Fresh, empty IndexedDB for every test.
  globalThis.indexedDB = new IDBFactory();
  delete document.documentElement.dataset.theme;
});

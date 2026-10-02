import { afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";

GlobalRegistrator.register({ url: "http://localhost:3000/" });

// Imported after registration so they see the DOM globals.
const { cleanup } = await import("@testing-library/react");
const { installCanvasMock, mockPixels } = await import("./canvas-mock");

installCanvasMock();

// No real network in tests: anything that needs a server installs its own fetch.
const noNetwork = () => Promise.reject(new TypeError("No network in tests"));
globalThis.fetch = noNetwork as unknown as typeof fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = noNetwork as unknown as typeof fetch;
  mockPixels(null);
  localStorage.clear();
  // Fresh, empty IndexedDB for every test.
  globalThis.indexedDB = new IDBFactory();
  delete document.documentElement.dataset.theme;
});

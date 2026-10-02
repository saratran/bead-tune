import { afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost:3000/" });

// Imported after registration so they see the DOM globals.
const { cleanup } = await import("@testing-library/react");
const { installCanvasMock } = await import("./canvas-mock");

installCanvasMock();

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

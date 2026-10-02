import { createProjectsApi } from "../server/projectsApi";

/** Routes fetch("/api/…") to an in-memory projects API, like the real server. */
export function useInMemoryServer(): ReturnType<typeof createProjectsApi> {
  const api = createProjectsApi(":memory:");
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost:3000");
    if (!url.pathname.startsWith("/api/")) throw new TypeError("No network in tests");
    return api.handle(new Request(url, init));
  }) as typeof fetch;
  return api;
}

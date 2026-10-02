/**
 * Runs Auto's candidate evaluation on a pool of Web Workers (one per spare CPU
 * core), so searches and tuning use the whole machine and the page stays smooth.
 */
import type { AutoEngine, Candidate, Evaluated, EvaluateMany, Tone } from "./auto";
import type { WorkerReply, WorkerRequest } from "./autoWorker";
import type { PipelineSettings } from "./pipeline";

export const WORKER_URL = "/auto-worker.js";

/** Workers to start: all cores but one (for the page), at most 8. */
export function poolSize(): number {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
  return Math.max(1, Math.min(8, cores - 1));
}

/** Whether this browser can run the pool (workers with their own canvas). */
export function canUseWorkers(): boolean {
  return typeof Worker === "function" && typeof OffscreenCanvas === "function" && typeof createImageBitmap === "function";
}

interface Job {
  id: number;
  key: string;
  tone: Tone;
  candidate: Candidate;
  signal?: AbortSignal;
  resolve: (r: Evaluated | null, skipped?: boolean) => void;
}

/**
 * Starts the workers and waits until they're ready. Rejects (after stopping them)
 * if they can't load, so callers can fall back to evaluating on the main thread.
 */
export async function workerEngine(
  image: ImageBitmap | ImageData,
  base: PipelineSettings,
  { url = WORKER_URL, size = poolSize(), timeoutMs = 10000 }: { url?: string; size?: number; timeoutMs?: number } = {},
): Promise<AutoEngine & { size: number }> {
  const workers = Array.from({ length: size }, () => new Worker(url, { type: "module" }));
  const stop = () => workers.forEach((w) => w.terminate());
  try {
    await Promise.race([
      Promise.all(
        workers.map(
          (w) =>
            new Promise<void>((resolve, reject) => {
              w.onmessage = (e: MessageEvent<WorkerReply>) => e.data.type === "ready" && resolve();
              w.onerror = (e) => reject(new Error(`Auto worker failed to start: ${e.message ?? "load error"}`));
              w.postMessage({ type: "init", image, base } satisfies WorkerRequest);
            }),
        ),
      ),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Auto workers took too long to start")), timeoutMs)),
    ]);
  } catch (err) {
    stop();
    throw err;
  }

  const queue: Job[] = [];
  const running: (Job | null)[] = workers.map(() => null);
  // Which worker built each candidate: it has the build cached, so scoring it for another tone is quick there.
  const builtBy = new Map<string, number>();
  let nextId = 0;

  const pump = () => {
    for (let w = 0; w < workers.length; w++) {
      while (!running[w] && queue.length) {
        // Prefer work this worker has already built (or nobody has), else take the oldest.
        let pick = 0;
        for (let i = 0; i < Math.min(queue.length, 64); i++) {
          const owner = builtBy.get(queue[i]!.key);
          if (owner === undefined || owner === w) {
            pick = i;
            break;
          }
        }
        const job = queue.splice(pick, 1)[0]!;
        if (job.signal?.aborted) {
          job.resolve(null, true);
          continue;
        }
        if (!builtBy.has(job.key)) builtBy.set(job.key, w);
        running[w] = job;
        workers[w]!.postMessage({ type: "eval", id: job.id, candidate: job.candidate, tone: job.tone } satisfies WorkerRequest);
      }
    }
  };

  const finish = (w: number, result: Evaluated | null) => {
    const job = running[w];
    running[w] = null;
    job?.resolve(result);
    pump();
  };
  workers.forEach((worker, w) => {
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      if (e.data.type !== "result") return;
      if (e.data.error) console.warn("Auto worker:", e.data.error);
      finish(w, e.data.result);
    };
    worker.onerror = (e) => {
      console.warn("Auto worker error:", e.message);
      finish(w, null);
    };
  });

  // Each (tone, candidate) is evaluated once; refinement often comes back to the same point.
  const cache = new Map<string, Promise<Evaluated | null>>();
  const evaluateOne = (candidate: Candidate, tone: Tone, signal?: AbortSignal): Promise<Evaluated | null> => {
    const key = JSON.stringify(candidate);
    const cacheKey = `${tone}|${key}`;
    const hit = cache.get(cacheKey);
    if (hit) return hit;
    const promise = new Promise<Evaluated | null>((resolve) => {
      queue.push({
        id: nextId++,
        key,
        tone,
        candidate,
        signal,
        resolve: (r, skipped) => {
          if (skipped) cache.delete(cacheKey); // stopped before it ran: try again next time
          resolve(r);
        },
      });
    });
    cache.set(cacheKey, promise);
    pump();
    return promise;
  };

  const tones = new Map<Tone, EvaluateMany>();
  return {
    size,
    forTone(tone) {
      if (!tones.has(tone)) {
        tones.set(tone, (candidates, onEach, signal) =>
          Promise.all(
            candidates.map((c) =>
              evaluateOne(c, tone, signal).then((r) => {
                onEach?.();
                return r;
              }),
            ),
          ),
        );
      }
      return tones.get(tone)!;
    },
    dispose() {
      stop();
      for (const job of queue.splice(0)) job.resolve(null, true);
      running.forEach((job, w) => job && finish(w, null));
    },
  };
}

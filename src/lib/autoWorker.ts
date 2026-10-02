/**
 * Web Worker for Auto: builds and scores candidates off the main thread.
 * Served as /auto-worker.js (bundled by server.ts); see autoPool.ts.
 */
import { makeEvaluator, type Candidate, type Evaluated, type Tone } from "./auto";
import type { PipelineSettings } from "./pipeline";
import { canvasSource, imageDataSource, type ImageSource } from "./sampling";

export type WorkerRequest =
  | { type: "init"; image: ImageBitmap | ImageData; base: PipelineSettings }
  | { type: "eval"; id: number; candidate: Candidate; tone: Tone };

export type WorkerReply = { type: "ready" } | { type: "result"; id: number; result: Evaluated | null; error?: string };

let evaluatorFor: ((tone: Tone) => (c: Candidate) => Evaluated | null) | null = null;

const reply = (m: WorkerReply) => (self as unknown as Worker).postMessage(m);

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const m = e.data;
  if (m.type === "init") {
    const source: ImageSource = "close" in m.image ? canvasSource(m.image) : imageDataSource(m.image);
    // Builds are shared between tones; each tone scores them against its own target.
    const builds = new Map();
    const evaluators = new Map<Tone, (c: Candidate) => Evaluated | null>();
    evaluatorFor = (tone) => {
      if (!evaluators.has(tone)) evaluators.set(tone, makeEvaluator(source, m.base, tone, builds));
      return evaluators.get(tone)!;
    };
    reply({ type: "ready" });
    return;
  }
  try {
    reply({ type: "result", id: m.id, result: evaluatorFor!(m.tone)(m.candidate) });
  } catch (err) {
    reply({ type: "result", id: m.id, result: null, error: String(err) });
  }
};

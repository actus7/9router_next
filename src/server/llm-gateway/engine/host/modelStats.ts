// Host adapter contract: what the gateway has measured about each model.
//
// The engine records one datum per attempt and reads aggregated stats back to
// rank candidates and size first-byte patience. It never touches the database:
// the application layer installs a store here at startup (see
// application/modelStatsStore.ts). With no store installed every call is a
// no-op / empty, so the engine behaves exactly as it did before measurements.

import type { ModelStat } from "@/shared/observability/modelStats";
import { processSlot } from "./processSlot";

export {
  adaptiveFirstByteBudget,
  blendScores,
  conversationPrefixKey,
  estimatePromptTokens,
  hedgeDelayMs,
  isLargePrompt,
  LARGE_PROMPT_TOKENS,
  perfKey,
  type ModelStat,
  type ScorePrior,
} from "@/shared/observability/modelStats";

export type AttemptDatum = {
  modelKey: string;
  /** `throughput` carries a finished stream's generation speed and counts as no attempt. */
  outcome: "ok" | "fail" | "timeout" | "throughput";
  /** Time to first response of a successful attempt. */
  ttftMs?: number;
  genTokens?: number;
  genMs?: number;
};

// The combo knows which model an attempt is (and its size band); the stream
// that ends long after the combo returned does not. The key rides the body.
const PERF_KEY = Symbol.for("routerx.modelPerf.key");

export function setPerfKey(body: Record<string, unknown>, key: string): void {
  (body as Record<symbol, unknown>)[PERF_KEY] = key;
}

export function getPerfKey(body: Record<string, unknown> | null | undefined): string | undefined {
  const key = body ? (body as Record<symbol, unknown>)[PERF_KEY] : undefined;
  return typeof key === "string" ? key : undefined;
}

export interface ModelStatsStore {
  record(datum: AttemptDatum): void;
  read(): Promise<Map<string, ModelStat>>;
}

const installed = processSlot<ModelStatsStore>("modelStats");

export function setModelStatsStore(store: ModelStatsStore | null): void {
  installed.set(store);
}

export function recordAttemptDatum(datum: AttemptDatum): void {
  try {
    installed.get()?.record(datum);
  } catch {
    // Measurement is best-effort; it must never fail a request.
  }
}

export async function loadModelStats(): Promise<Map<string, ModelStat>> {
  const store = installed.get();
  if (!store) return new Map();
  try {
    return await store.read();
  } catch {
    return new Map();
  }
}

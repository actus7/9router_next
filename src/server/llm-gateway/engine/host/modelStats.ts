// Host adapter contract: what the gateway has measured about each model.
//
// The engine records one datum per attempt and reads aggregated stats back to
// rank candidates and size first-byte patience. It never touches the database:
// the application layer installs a store here at startup (see
// application/modelStatsStore.ts). With no store installed every call is a
// no-op / empty, so the engine behaves exactly as it did before measurements.

import type { ModelStat } from "@/shared/observability/modelStats";

export {
  adaptiveFirstByteBudget,
  blendScores,
  type ModelStat,
  type ScorePrior,
} from "@/shared/observability/modelStats";

export type AttemptDatum = {
  modelKey: string;
  outcome: "ok" | "fail" | "timeout";
  /** Time to first response of a successful attempt. */
  ttftMs?: number;
};

export interface ModelStatsStore {
  record(datum: AttemptDatum): void;
  read(): Promise<Map<string, ModelStat>>;
}

let installed: ModelStatsStore | null = null;

export function setModelStatsStore(store: ModelStatsStore | null): void {
  installed = store;
}

export function recordAttemptDatum(datum: AttemptDatum): void {
  try {
    installed?.record(datum);
  } catch {
    // Measurement is best-effort; it must never fail a request.
  }
}

export async function loadModelStats(): Promise<Map<string, ModelStat>> {
  if (!installed) return new Map();
  try {
    return await installed.read();
  } catch {
    return new Map();
  }
}

import { makeKv } from "../helpers/kvStore";
// Types come from the engine types file directly (the way smartModelProfilesRepo
// does) rather than from the @/server/llm-gateway barrel: the barrel pulls in
// the inventory, which reads repos, which would close an import cycle.
import type { AaModelMetrics, AaSnapshotMeta } from "@/server/llm-gateway/engine/services/smart-routing/types";

// Two keys, one scope: the meta row answers "is this snapshot fresh?" without
// dragging every model over the wire on each TTL check.
const aaKv = makeKv("artificialAnalysis");
const META_KEY = "meta";
const MODELS_KEY = "models";

export async function getAaSnapshotMeta(): Promise<AaSnapshotMeta | null> {
  return await aaKv.get<AaSnapshotMeta>(META_KEY);
}

/** Metrics keyed by normalized model name (see normalizeModelName in the use-case). */
export async function getAaModels(): Promise<Record<string, AaModelMetrics>> {
  return (await aaKv.get<Record<string, AaModelMetrics>>(MODELS_KEY, {})) || {};
}

export async function saveAaSnapshot(meta: AaSnapshotMeta, models: Record<string, AaModelMetrics>): Promise<void> {
  // Meta and models are written together so a fresh timestamp can never stand
  // next to an empty (or the previous) model table.
  await aaKv.setMany({ [META_KEY]: meta, [MODELS_KEY]: models });
}

import { makeKv } from "../helpers/kvStore";

/**
 * Per-model cache of LLM profile suggestions (smart routing "Suggest models
 * with AI"). One kv row per modelKey under scope `smartSuggest`: a run writes
 * only the models it analyzed (setMany) and the untouched rows stay valid,
 * which is exactly the "keep the fresh ones" merge the use-case wants.
 */

/** One analyzed model: when/against what it was analyzed, and what the LLM said. */
export interface CachedSuggestion {
  analyzedAt: string;
  inventoryFingerprint: string;
  aaFingerprint: string | null;
  suggestion: {
    quality: number;
    latencyScore: number;
    reliabilityScore: number;
    recommendedTier: string;
    needScores: Record<string, number>;
    sources: string[];
  };
}

const suggestKv = makeKv("smartSuggest");

export async function getSuggestions(): Promise<Record<string, CachedSuggestion>> {
  const raw = await suggestKv.getAll();
  const out: Record<string, CachedSuggestion> = {};
  for (const [modelKey, value] of Object.entries(raw)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[modelKey] = value as CachedSuggestion;
    }
  }
  return out;
}

export async function saveSuggestions(entries: Record<string, CachedSuggestion>): Promise<void> {
  await suggestKv.setMany(entries);
}

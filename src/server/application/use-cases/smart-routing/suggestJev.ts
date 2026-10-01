import "server-only";

import { decideWithJev, type JevQuestion } from "@/server/decisions/jev";
import type { RouteNeed, RoutingTier } from "@/server/llm-gateway/smart-routing";

// The judge's wording, copied from routingClassifier.ts: the same criteria
// everywhere a tier/need goes to Jev, without either module importing the other.
const JEV_TIER_CRITERIA: Record<RoutingTier, string> = {
  simple: "Lookup, greeting, rewording or a one-step answer any small model gets right",
  standard: "Ordinary multi-step work: explain, summarize, write or edit code of modest size",
  complex: "Large or multi-part work needing strong models: architecture, long code, deep analysis",
  reasoning: "Formal reasoning: proofs, math, logic puzzles, planning where each step must be verified",
};

const JEV_NEED_CRITERIA: Record<RouteNeed, string> = {
  general: "General conversation or writing with no special capability",
  vision: "Understanding an attached image",
  tool_use: "Calling tools or functions",
  coding: "Writing, reviewing or debugging code",
  data_analysis: "Analysing tables, numbers or datasets",
  web_search: "Needs fresh information searched on the web",
  web_fetch: "Needs to read a specific URL",
  image_generation: "Create or edit an image",
  video_generation: "Create a video",
  tts: "Turn text into speech",
  stt: "Transcribe audio",
  embeddings: "Produce vector embeddings",
  email_management: "Read, write or organise email",
  calendar_management: "Read or change calendar events",
  social_media: "Draft or manage social media posts",
  trading: "Market data, trading or finance operations",
};

const JEV_SUGGEST_MIN_CONFIDENCE = 0.7;
const JEV_SUGGEST_TIMEOUT_MS = 10_000;

export interface JevSuggestionOverride {
  tier?: RoutingTier;
  need?: RouteNeed;
}

export interface SuggestableModel {
  modelKey: string;
  description?: string;
  pricing?: unknown;
  deterministicTier?: string;
}

/**
 * One Jev call per batch of models: `tier_<i>`/`need_<i>` typed choices over
 * the same criteria the request classifier asks with. Only well-formed answers
 * at confidence >= 0.7 come back — everything else (feature off, no key,
 * timeout, low confidence) leaves the model out and its LLM suggestion stands.
 * Fail-open, like every other Jev caller.
 */
export async function jevSuggestionOverrides(models: SuggestableModel[]): Promise<Map<string, JevSuggestionOverride>> {
  const overrides = new Map<string, JevSuggestionOverride>();
  if (models.length === 0) return overrides;
  const state = {
    models: models.map((model, index) => ({
      id: `m${index}`,
      modelKey: model.modelKey,
      ...(model.description ? { description: model.description } : {}),
      ...(model.pricing === undefined ? {} : { pricing: model.pricing }),
      ...(model.deterministicTier ? { deterministicTier: model.deterministicTier } : {}),
    })),
  };
  const questions: Record<string, JevQuestion> = {};
  for (let index = 0; index < models.length; index += 1) {
    questions[`tier_${index}`] = {
      type: "choice",
      instructions: "Which capability tier does this model belong to, judged from its name, description and pricing? Ignore marketing suffixes.",
      criteria: JEV_TIER_CRITERIA,
    };
    questions[`need_${index}`] = {
      type: "choice",
      instructions: "Which capability is this model best suited for? Judge from its name and description.",
      criteria: JEV_NEED_CRITERIA,
    };
  }
  const decision = await decideWithJev("suggestRouting", state, questions, { timeoutMs: JEV_SUGGEST_TIMEOUT_MS });
  if (!decision) return overrides;
  for (const [index, model] of models.entries()) {
    const override: JevSuggestionOverride = {};
    const tier = decision.answers[`tier_${index}`];
    if (tier?.type === "choice" && tier.confidence >= JEV_SUGGEST_MIN_CONFIDENCE && Object.hasOwn(JEV_TIER_CRITERIA, tier.choice)) {
      override.tier = tier.choice as RoutingTier;
    }
    const need = decision.answers[`need_${index}`];
    if (need?.type === "choice" && need.confidence >= JEV_SUGGEST_MIN_CONFIDENCE && Object.hasOwn(JEV_NEED_CRITERIA, need.choice)) {
      override.need = need.choice as RouteNeed;
    }
    if (override.tier || override.need) overrides.set(model.modelKey, override);
  }
  return overrides;
}

/**
 * The hybrid: Jev decides the typed categories (the tier, the dominant need)
 * and the LLM keeps the numeric scores it produced — `needScores` passes
 * through untouched. No Jev verdict leaves the suggestion exactly as the LLM
 * (fences stripped, rebalanced downstream) built it.
 */
export function overlayJevSuggestion<T extends Record<string, unknown>>(
  suggestion: T,
  override: JevSuggestionOverride | undefined,
): T {
  if (!override) return suggestion;
  return {
    ...suggestion,
    ...(override.tier ? { recommendedTier: override.tier } : {}),
    ...(override.need ? { need: override.need } : {}),
  };
}

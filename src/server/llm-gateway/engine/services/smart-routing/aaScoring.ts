/**
 * Artificial Analysis scoring for the suggestion board. Pure math over
 * already-fetched metrics: no I/O, no app/db imports — the snapshot fetch and
 * the name matching live in the application use-case.
 *
 * AA metrics are third-party ground truth when present and the deterministic
 * heuristics (`quality`, `latencyScore`) are the stand-in when they are not, so
 * a model outside the AA table still gets a full score instead of dropping out.
 */

import { ROUTING_TIERS, type RoutingTier, type SmartModelProfile } from "./types";

/**
 * What each tier buys: the cheap lanes win on cost and throughput, "complex" is
 * mostly quality, and "reasoning" pays for quality and tolerates latency.
 * Product policy (weights per tier sum to 1):
 *   simple    quality .20 speed .30 cost .35 latency .15
 *   standard  quality .45 speed .20 cost .25 latency .10
 *   complex   quality .65 speed .10 cost .15 latency .10
 *   reasoning quality .70 speed .05 cost .10 latency .15
 */
export const AA_TIER_WEIGHTS: Record<RoutingTier, { quality: number; speed: number; cost: number; latency: number }> = {
  simple: { quality: 0.2, speed: 0.3, cost: 0.35, latency: 0.15 },
  standard: { quality: 0.45, speed: 0.2, cost: 0.25, latency: 0.1 },
  complex: { quality: 0.65, speed: 0.1, cost: 0.15, latency: 0.1 },
  reasoning: { quality: 0.7, speed: 0.05, cost: 0.1, latency: 0.15 },
};

// Blended price assumes 3 input tokens per output token — the mix quoted in the
// reason line ("3:1") and the one the cost component is normalized against.
export const TOKEN_MIX_INPUT = 3_000;
export const TOKEN_MIX_OUTPUT = 1_000;

// Which AA indices each tier's "quality" is made of. `math` is not in any mix
// on purpose: intelligence already tracks mathematical ability closely enough
// for routing, and the board line stays compact.
const TIER_QUALITY_MIX: Record<RoutingTier, { intelligence: number; coding: number; agentic: number }> = {
  simple: { intelligence: 1, coding: 0, agentic: 0 },
  standard: { intelligence: 1, coding: 0, agentic: 0 },
  complex: { intelligence: 0.5, coding: 0.3, agentic: 0.2 },
  reasoning: { intelligence: 0.7, coding: 0, agentic: 0.3 },
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function maxOf(values: Array<number | null>): number {
  let max = 0;
  for (const value of values) {
    if (value !== null && Number.isFinite(value) && value > max) max = value;
  }
  return max;
}

/**
 * Blended USD per 1M tokens at the 3:1 mix. AA prices win when they exist (the
 * score is a statement about AA's table); the catalog's own prices are the
 * fallback. null = no price at all, which is not the same as "expensive".
 */
function blendedPriceUsd(profile: SmartModelProfile): number | null {
  const aa = profile.aa;
  const useAa = aa !== undefined && (aa.inputUsdPer1M !== null || aa.outputUsdPer1M !== null);
  const input = useAa ? aa.inputUsdPer1M : profile.inputPrice;
  const output = useAa ? aa.outputUsdPer1M : profile.outputPrice;
  let weightSum = 0;
  let acc = 0;
  // Only the sides that have a price enter the mix: a missing side is unknown,
  // not zero — renormalizing keeps the blend on the data that exists.
  if (input !== null && Number.isFinite(input)) {
    weightSum += TOKEN_MIX_INPUT;
    acc += TOKEN_MIX_INPUT * input;
  }
  if (output !== null && Number.isFinite(output)) {
    weightSum += TOKEN_MIX_OUTPUT;
    acc += TOKEN_MIX_OUTPUT * output;
  }
  return weightSum > 0 ? acc / weightSum : null;
}

/** 0..1 quality for one tier: AA indices renormalized over the fields present. */
function qualityComponent(profile: SmartModelProfile, tier: RoutingTier): number {
  const aa = profile.aa;
  if (!aa) return clamp01(profile.quality);
  const mix = TIER_QUALITY_MIX[tier];
  const fields: Array<[number, number | null]> = [
    [mix.intelligence, aa.intelligence],
    [mix.coding, aa.coding],
    [mix.agentic, aa.agentic],
  ];
  let weightSum = 0;
  let acc = 0;
  for (const [weight, value] of fields) {
    if (weight <= 0 || value === null || !Number.isFinite(value)) continue;
    weightSum += weight;
    acc += weight * value;
  }
  // Every index this tier weights is missing: the heuristic stands.
  if (weightSum <= 0) return clamp01(profile.quality);
  return clamp01(acc / weightSum / 100);
}

/**
 * Per-model, per-tier score 0..1. Speed/cost/latency are normalized against the
 * candidates passed in (a metric only means something next to the rest of the
 * shortlist), quality against the AA 0-100 scale.
 */
export function computeAaTierScores(profiles: SmartModelProfile[]): Record<string, Record<RoutingTier, number>> {
  const maxTps = maxOf(profiles.map((profile) => profile.aa?.outputTokensPerSecond ?? null));
  const maxTtft = maxOf(profiles.map((profile) => profile.aa?.ttftSeconds ?? null));
  const maxBlended = maxOf(profiles.map(blendedPriceUsd));

  const out: Record<string, Record<RoutingTier, number>> = {};
  for (const profile of profiles) {
    const tps = profile.aa?.outputTokensPerSecond ?? null;
    const ttft = profile.aa?.ttftSeconds ?? null;
    const blended = blendedPriceUsd(profile);
    const quality = {} as Record<RoutingTier, number>;
    for (const tier of ROUTING_TIERS) quality[tier] = qualityComponent(profile, tier);
    // No AA throughput/latency → the heuristic speed score keeps its slot; no
    // price at all → neutral 0.5, so an unpriced free model is not ranked last.
    const speed = tps !== null && maxTps > 0 ? clamp01(tps / maxTps) : clamp01(profile.latencyScore);
    const cost = blended === null ? 0.5 : maxBlended > 0 ? clamp01(1 - blended / maxBlended) : 1;
    const latency = ttft !== null && maxTtft > 0 ? clamp01(1 - ttft / maxTtft) : clamp01(profile.latencyScore);

    const byTier = {} as Record<RoutingTier, number>;
    for (const tier of ROUTING_TIERS) {
      const weights = AA_TIER_WEIGHTS[tier];
      byTier[tier] = clamp01(
        weights.quality * quality[tier] + weights.speed * speed + weights.cost * cost + weights.latency * latency,
      );
    }
    out[profile.modelKey] = byTier;
  }
  return out;
}

/**
 * Compact English line for the suggestion board, e.g.
 * "AA intel 63 · code 56 · agentic 48 · 154 tok/s · TTFT 0.9s · $0.86/1M blended (3:1)".
 * Only published metrics are quoted — the same line serves every tier column,
 * so `tier` is the caller's context (which column asked), not a filter. No AA
 * metrics, no line.
 */
export function buildAaSuggestionReason(profile: SmartModelProfile, tier: RoutingTier): string | undefined {
  const aa = profile.aa;
  if (!aa) return undefined;
  void tier; // documented above: the line is deliberately tier-invariant
  const parts: string[] = [];
  if (aa.intelligence !== null) parts.push(`AA intel ${Math.round(aa.intelligence)}`);
  if (aa.coding !== null) parts.push(`code ${Math.round(aa.coding)}`);
  if (aa.agentic !== null) parts.push(`agentic ${Math.round(aa.agentic)}`);
  if (aa.outputTokensPerSecond !== null) parts.push(`${Math.round(aa.outputTokensPerSecond)} tok/s`);
  if (aa.ttftSeconds !== null) parts.push(`TTFT ${aa.ttftSeconds.toFixed(1)}s`);
  const blended = blendedPriceUsd(profile);
  if (blended !== null) parts.push(`$${blended.toFixed(2)}/1M blended (3:1)`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * New profiles carrying `aaScores` for the four tiers and a `suggestionReason`.
 * Only models with AA metrics get them: everything else is already ranked by
 * the deterministic scores and must not grow AA-shaped holes.
 */
export function attachAaScoresAndReasons(profiles: SmartModelProfile[]): { profiles: SmartModelProfile[] } {
  const scores = computeAaTierScores(profiles);
  return {
    profiles: profiles.map((profile) => {
      if (!profile.aa) return profile;
      const suggestionReason = buildAaSuggestionReason(profile, profile.recommendedTier);
      return {
        ...profile,
        aaScores: scores[profile.modelKey],
        ...(suggestionReason ? { suggestionReason } : {}),
      };
    }),
  };
}

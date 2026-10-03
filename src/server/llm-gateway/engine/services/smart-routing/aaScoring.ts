/**
 * Artificial Analysis primitives for the suggestion board. Pure math over
 * already-fetched metrics: no I/O, no app/db imports — the snapshot fetch and
 * the name matching live in the application use-case, and lane assignment
 * (normalization, eligibility, ordering) lives in laneAssignment.
 */

import type { AaModelMetrics, RoutingTier, SmartModelProfile } from "./types";

/**
 * What each tier buys: the cheap lanes win on cost and throughput, "complex" is
 * mostly quality, and "reasoning" pays for quality and tolerates latency.
 * Product policy (weights per tier sum to 1):
 *   simple    quality .20 speed .30 cost .35 latency .15
 *   standard  quality .45 speed .20 cost .25 latency .10
 *   complex   quality .70 speed .10 cost .15 latency .05
 *   reasoning quality .80 speed .05 cost .10 latency .05
 * Latency is light in the two upper lanes on purpose: AA's TTFT for a
 * reasoning model includes its thinking, so weighting it punished exactly the
 * models those lanes exist for.
 */
export const AA_TIER_WEIGHTS: Record<RoutingTier, { quality: number; speed: number; cost: number; latency: number }> = {
  simple: { quality: 0.2, speed: 0.3, cost: 0.35, latency: 0.15 },
  standard: { quality: 0.45, speed: 0.2, cost: 0.25, latency: 0.1 },
  complex: { quality: 0.7, speed: 0.1, cost: 0.15, latency: 0.05 },
  reasoning: { quality: 0.8, speed: 0.05, cost: 0.1, latency: 0.05 },
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

/**
 * Blended USD per 1M tokens at the 3:1 mix. AA prices win when they exist (the
 * score is a statement about AA's table); the catalog's own prices are the
 * fallback. null = no price at all, which is not the same as "expensive".
 */
export function blendedPriceUsd(profile: SmartModelProfile): number | null {
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

/**
 * Raw AA quality for one tier on AA's 0-100 scale: the tier's index mix,
 * renormalized over the indices that were published. null when none were.
 */
export function aaTierQuality(aa: AaModelMetrics | undefined, tier: RoutingTier): number | null {
  if (!aa) return null;
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
  // A tier whose own indices are missing still has intelligence to go on.
  if (weightSum <= 0) return aa.intelligence !== null && Number.isFinite(aa.intelligence) ? aa.intelligence : null;
  return acc / weightSum;
}

/**
 * Compact English line for the suggestion board, e.g.
 * "AA intel 63 · code 56 · agentic 48 · 154 tok/s · TTFT 0.9s · $0.86/1M blended (3:1)".
 * Only published metrics are quoted. No AA metrics, no line.
 */
export function buildAaSuggestionReason(profile: SmartModelProfile): string | undefined {
  const aa = profile.aa;
  if (!aa) return undefined;
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

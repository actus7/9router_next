/**
 * Lane assignment for "Suggest models with AI": which of the four complexity
 * lanes each model belongs to, and how it ranks there. Pure and deterministic —
 * the same inventory and AA snapshot always produce the same board.
 *
 * It replaced an LLM classifier that picked one lane per model with the AA
 * numbers as prompt context, followed by a Jev override. That put Gemini 3.1
 * Pro in Simple, MiMo V2.5 above V2.6, and let a name-regex guess of 80%
 * outrank measured models. Here the measurements decide:
 *
 * 1. Quality per lane is AA's index mix, relative to the best model in this
 *    inventory. Unmeasured models inherit from a measured sibling of their
 *    family (discounted) or fall back to the name heuristic, discounted further
 *    so a guess never outranks a measurement.
 * 2. An older generation leaves the board when a newer one of the same family
 *    and size measures at least as well.
 * 3. Eligibility is by percentile within this inventory: Reasoning and Complex
 *    take the upper bands, Simple takes cheap/fast models and excludes the top
 *    band. A model can hold several lanes, as an operator would arrange them.
 * 4. Each eligible lane gets a Balanced score (AA_TIER_WEIGHTS) and a
 *    quality-only score; the board orders by whichever preset is chosen.
 */

import { AA_TIER_WEIGHTS, aaTierQuality, blendedPriceUsd, buildAaSuggestionReason } from "./aaScoring";
import { canonicalModelKey, compareVersions, FLAGSHIP_PATTERN, modelFamily, SMALL_VARIANT_PATTERN, type ModelFamily } from "./modelIdentity";
import { ROUTING_TIERS, type RoutingTier, type SmartModelProfile } from "./types";

// A guess sits below a measurement: the name heuristic tops out at 0.98, so a
// discounted guess (≤ ~0.59 relative quality) stays under the measured upper
// bands. ponytail: a flat discount, calibrate from telemetry if it misranks.
const UNMEASURED_DISCOUNT = 0.6;
// An unmeasured model with a measured family sibling is estimated from it.
const FAMILY_ESTIMATE_DISCOUNT = 0.9;
// A newer generation replaces an older one unless it measures clearly worse.
const SUPERSEDE_TOLERANCE = 0.02;
// Percentile of lane quality (within this inventory) a model needs to enter.
const QUALITY_FLOOR: Record<Exclude<RoutingTier, "simple">, number> = {
  standard: 0.2,
  complex: 0.45,
  reasoning: 0.6,
};
// Simple is for cheap/fast work: a family's small variant qualifies on economy
// alone; another model only from the lower part of the quality range and the
// better half on price + speed. A model named as its family's top tier (pro,
// max, opus…) never does — a cheap or weak flagship is still a flagship.
const SIMPLE_QUALITY_CEILING = 0.5;
const SIMPLE_ECONOMY_FLOOR = 0.5;
// A small inventory still gets four usable lanes.
const MIN_LANE_SIZE = 3;
const REASONING_NAME = /(reason|thinking|deep-?think|(^|[^a-z])r1([^0-9]|$)|(^|[^a-z0-9])o[134]([^0-9]|$))/;

type TierNumbers = Record<RoutingTier, number>;

interface Scored {
  profile: SmartModelProfile;
  canonicalKey: string;
  family: ModelFamily | null;
  measured: boolean;
  quality: TierNumbers;
  speed: number;
  cost: number;
  latency: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function perTier(fn: (tier: RoutingTier) => number): TierNumbers {
  return Object.fromEntries(ROUTING_TIERS.map((tier) => [tier, fn(tier)])) as TierNumbers;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// Throughput, latency and price span orders of magnitude (22 to 360 tok/s,
// 1s to 170s TTFT, $0.2 to $10): on a linear scale every cheap model ties at
// ~1. Log keeps the differences that matter at the low end visible.
function logShare(value: number, max: number): number {
  return max > 0 ? clamp01(Math.log1p(value) / Math.log1p(max)) : 1;
}

function rawAaQuality(profile: SmartModelProfile): TierNumbers | null {
  const standard = aaTierQuality(profile.aa, "standard");
  if (standard === null) return null;
  return perTier((tier) => aaTierQuality(profile.aa, tier) ?? standard);
}

function score(profiles: SmartModelProfile[]): Scored[] {
  const raw = profiles.map(rawAaQuality);
  const maxRaw = perTier((tier) => Math.max(0, ...raw.map((item) => item?.[tier] ?? 0)));
  const maxTps = Math.max(0, ...profiles.map((profile) => profile.aa?.outputTokensPerSecond ?? 0));
  const maxTtft = Math.max(0, ...profiles.map((profile) => profile.aa?.ttftSeconds ?? 0));
  const prices = profiles.map(blendedPriceUsd);
  const maxPrice = Math.max(0, ...prices.map((price) => price ?? 0));

  const relative = raw.map((item) => (item ? perTier((tier) => (maxRaw[tier] > 0 ? item[tier] / maxRaw[tier] : 0)) : null));
  const familyBest = new Map<string, TierNumbers>();
  profiles.forEach((profile, index) => {
    const quality = relative[index];
    const family = modelFamily(profile.model);
    if (!quality || !family) return;
    const best = familyBest.get(family.family);
    familyBest.set(family.family, best ? perTier((tier) => Math.max(best[tier], quality[tier])) : quality);
  });

  return profiles.map((profile, index) => {
    const family = modelFamily(profile.model);
    const measured = relative[index];
    const sibling = family ? familyBest.get(family.family) : undefined;
    const quality = measured
      ?? (sibling
        ? perTier((tier) => sibling[tier] * FAMILY_ESTIMATE_DISCOUNT)
        : perTier(() => clamp01(profile.quality) * UNMEASURED_DISCOUNT));
    const tps = profile.aa?.outputTokensPerSecond;
    const ttft = profile.aa?.ttftSeconds;
    const price = prices[index];
    return {
      profile,
      canonicalKey: canonicalModelKey(profile.model),
      family,
      measured: measured !== null,
      quality,
      speed: finite(tps) ? logShare(tps, maxTps) : clamp01(profile.latencyScore) * UNMEASURED_DISCOUNT,
      // No price at all is unknown, not expensive: neutral, so an unpriced
      // free model is not ranked last.
      cost: price === null ? 0.5 : 1 - logShare(price, maxPrice),
      latency: finite(ttft) ? 1 - logShare(ttft, maxTtft) : clamp01(profile.latencyScore) * UNMEASURED_DISCOUNT,
    };
  });
}

/** Older generations whose newer sibling (same family and size) measures at least as well. */
function dropSuperseded(scored: Scored[]): Scored[] {
  return scored.filter((older) => !scored.some((newer) => (
    older.family !== null
    && newer.family !== null
    && newer.canonicalKey !== older.canonicalKey
    && newer.family.family === older.family.family
    && compareVersions(newer.family.version, older.family.version) > 0
    && newer.quality.standard >= older.quality.standard - SUPERSEDE_TOLERANCE
  )));
}

/** value → share of the inventory strictly below it (0 = worst, 1 = best). */
function percentileOf(values: number[]): (value: number) => number {
  const sorted = [...values].sort((a, b) => a - b);
  return (value) => {
    if (sorted.length <= 1) return 1;
    let below = 0;
    while (below < sorted.length && sorted[below] < value) below += 1;
    return below / (sorted.length - 1);
  };
}

/** One value per canonical model, so five providers of one model do not skew the percentiles. */
function perCanonical(scored: Scored[], pick: (item: Scored) => number): number[] {
  const best = new Map<string, number>();
  for (const item of scored) best.set(item.canonicalKey, Math.max(best.get(item.canonicalKey) ?? -Infinity, pick(item)));
  return [...best.values()];
}

function laneScore(item: Scored, tier: RoutingTier): number {
  const weights = AA_TIER_WEIGHTS[tier];
  return clamp01(
    weights.quality * item.quality[tier] + weights.speed * item.speed + weights.cost * item.cost + weights.latency * item.latency,
  );
}

function eligibleLanes(scored: Scored[]): Map<Scored, Set<RoutingTier>> {
  const economy = (item: Scored) => (item.cost + item.speed) / 2;
  const qualityPct = Object.fromEntries(ROUTING_TIERS.map((tier) => [
    tier,
    percentileOf(perCanonical(scored, (item) => item.quality[tier])),
  ])) as Record<RoutingTier, (value: number) => number>;
  const economyPct = percentileOf(perCanonical(scored, economy));

  const lanes = new Map<Scored, Set<RoutingTier>>();
  for (const item of scored) {
    const set = new Set<RoutingTier>();
    const pct = (tier: RoutingTier) => qualityPct[tier](item.quality[tier]);
    const id = item.profile.model.toLowerCase();
    const small = SMALL_VARIANT_PATTERN.test(id);
    const cheapAndFast = economyPct(economy(item)) >= SIMPLE_ECONOMY_FLOOR;
    const flagship = !small && FLAGSHIP_PATTERN.test(id);
    if (cheapAndFast && !flagship && (small || pct("simple") <= SIMPLE_QUALITY_CEILING)) set.add("simple");
    if (pct("standard") >= QUALITY_FLOOR.standard) set.add("standard");
    if (pct("complex") >= QUALITY_FLOOR.complex) set.add("complex");
    // Frontier models measured by AA reason by default; an unmeasured one has
    // to say so through its capabilities or its name. A small variant stays
    // out however well it measures: it is the fast sibling, not the one an
    // operator sends proofs to.
    const reasons = item.measured || item.profile.capabilities.reasoning || REASONING_NAME.test(id);
    if (reasons && !small && pct("reasoning") >= QUALITY_FLOOR.reasoning) set.add("reasoning");
    lanes.set(item, set);
  }

  // Tiny inventories: top up any lane short of MIN_LANE_SIZE distinct models
  // with the best-scoring ones for that lane.
  for (const tier of ROUTING_TIERS) {
    const members = new Set(scored.filter((item) => lanes.get(item)?.has(tier)).map((item) => item.canonicalKey));
    if (members.size >= MIN_LANE_SIZE) continue;
    const extras = scored
      .filter((item) => !members.has(item.canonicalKey))
      .sort((a, b) => laneScore(b, tier) - laneScore(a, tier));
    for (const item of extras) {
      if (members.size >= MIN_LANE_SIZE) break;
      lanes.get(item)?.add(tier);
      members.add(item.canonicalKey);
    }
  }
  return lanes;
}

/**
 * The inventory scored for the board: superseded generations removed, every
 * other profile tagged with its lanes, scores, canonical key and score source.
 * `quality`/`latencyScore` are replaced by the unified numbers, so a confirmed
 * profile carries the same scale the board ranked it on.
 */
export function assignLanes(profiles: SmartModelProfile[]): SmartModelProfile[] {
  if (profiles.length === 0) return [];
  const alive = dropSuperseded(score(profiles));
  const lanes = eligibleLanes(alive);
  return alive.map((item) => {
    const tiers = ROUTING_TIERS.filter((tier) => lanes.get(item)?.has(tier));
    const laneScores: Partial<Record<RoutingTier, number>> = {};
    const laneQuality: Partial<Record<RoutingTier, number>> = {};
    for (const tier of tiers) {
      laneScores[tier] = laneScore(item, tier);
      laneQuality[tier] = item.quality[tier];
    }
    const best = [...tiers].sort((a, b) => (laneScores[b] ?? 0) - (laneScores[a] ?? 0))[0];
    const reason = buildAaSuggestionReason(item.profile);
    return {
      ...item.profile,
      quality: item.quality.standard,
      latencyScore: item.speed,
      recommendedTier: best ?? item.profile.recommendedTier,
      laneScores,
      laneQuality,
      scoreSource: item.measured ? "measured" : "estimated",
      canonicalKey: item.canonicalKey,
      ...(reason ? { suggestionReason: reason } : {}),
    };
  });
}

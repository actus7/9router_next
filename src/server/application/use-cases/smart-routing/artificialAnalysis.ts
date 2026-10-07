import "server-only";

import { getAaModels, getAaSnapshotMeta, saveAaSnapshot } from "@/lib/db/repos/aaSnapshotRepo";
import { canonicalModelKey, type AaModelMetrics, type AaSnapshotMeta, type SmartModelProfile } from "@/server/llm-gateway/smart-routing";

// Artificial Analysis free tier: 100 requests/24h. One sync a day (the TTL
// below) keeps the suggestion pipeline fed without ever burning that budget —
// and everything here is fail-open: enrichment missing beats suggestion broken.
const AA_BASE_URL = "https://artificialanalysis.ai";
const AA_FREE_ENDPOINT = "/api/v2/language/models/free";
const SYNC_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_PAGES = 8;
const REQUEST_TIMEOUT_MS = 15_000;

/** What the AA fetch produced: the meta row plus metrics keyed by normalized name. */
export interface AaSnapshot {
  meta: AaSnapshotMeta;
  byNormName: Record<string, AaModelMetrics>;
}

/**
 * "claude-sonnet-4.5" and "claude-sonnet-4-5" are the same model: dropping case
 * and everything outside [a-z0-9] gives both the same key. That is the whole
 * matching strategy — AA's table and our catalog spell versions differently.
 */
export function normalizeModelName(name: string): string {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// AA files the classification in the name itself: "Gemini 2.5 Flash
// (Reasoning)" and "Gemini 2.5 Flash (Non-reasoning)" are two rows, and the
// parenthetical normalizes into the key ("gemini25flashreasoning"), which
// never equals our catalog id ("gemini-2.5-flash"). Stripping those suffixes
// yields the base name both sides agree on. Model sizes ("122b-a10b") and
// product names ("max", "thinking") are part of the model — never stripped.
const AA_CLASSIFICATION_SUFFIXES = ["nonreasoning", "reasoning", "defaultfallback", "xhigh", "high", "low"];

/** The model name with AA classification suffixes removed ("gemini25flashreasoning" → "gemini25flash"). */
export function baseModelName(name: string): string {
  let key = normalizeModelName(name);
  for (;;) {
    let stripped = key;
    for (const suffix of AA_CLASSIFICATION_SUFFIXES) {
      if (stripped.endsWith(suffix) && stripped.length - suffix.length >= 4) {
        stripped = stripped.slice(0, -suffix.length);
      }
    }
    if (stripped === key) return key;
    key = stripped;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

// Every number in the AA payload is optional and free-form: Number() with an
// isFinite check turns "measured and sane" into a number and everything else
// (absent, null, "") into null — never into a zero that would score as real.
function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** One `data[]` row of the free endpoint mapped onto AaModelMetrics. */
function mapAaModel(raw: unknown): AaModelMetrics | null {
  const item = asRecord(raw);
  const slug = typeof item.slug === "string" ? item.slug : "";
  const name = typeof item.name === "string" && item.name ? item.name : slug;
  if (!name) return null;
  const creator = asRecord(item.model_creator);
  const evaluations = asRecord(item.evaluations);
  const pricing = asRecord(item.pricing);
  const performance = asRecord(item.performance);
  const benchmarkCost = asRecord(item.artificial_analysis_intelligence_index_cost);
  return {
    aaId: typeof item.id === "string" ? item.id : slug,
    slug,
    name,
    creator: typeof creator.name === "string" ? creator.name : null,
    intelligence: finiteNumber(evaluations.artificial_analysis_intelligence_index),
    coding: finiteNumber(evaluations.artificial_analysis_coding_index),
    agentic: finiteNumber(evaluations.artificial_analysis_agentic_index),
    math: finiteNumber(evaluations.artificial_analysis_math_index),
    inputUsdPer1M: finiteNumber(pricing.price_1m_input_tokens),
    outputUsdPer1M: finiteNumber(pricing.price_1m_output_tokens),
    outputTokensPerSecond: finiteNumber(performance.median_output_tokens_per_second),
    ttftSeconds: finiteNumber(performance.median_time_to_first_token_seconds),
    benchmarkCostUsd: finiteNumber(benchmarkCost.total_cost),
  };
}

async function fetchAaSnapshot(apiKey: string): Promise<AaSnapshot> {
  const rows: AaModelMetrics[] = [];
  const seen = new Set<string>();
  let indexVersion: number | null = null;
  let tier: string | null = null;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await fetch(`${AA_BASE_URL}${AA_FREE_ENDPOINT}?page=${page}`, {
      headers: { accept: "application/json", "x-api-key": apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Artificial Analysis responded ${response.status}`);
    const body = asRecord(await response.json());
    if (indexVersion === null) indexVersion = finiteNumber(body.intelligence_index_version);
    if (tier === null) tier = typeof body.tier === "string" ? body.tier : null;
    for (const raw of Array.isArray(body.data) ? body.data : []) {
      const model = mapAaModel(raw);
      if (!model) continue;
      const key = normalizeModelName(model.name);
      // First row wins on a normalized-name collision: two AA entries aliasing
      // into one key are equally valid matches and re-storing changes nothing.
      if (key && !seen.has(key)) {
        seen.add(key);
        rows.push(model);
      }
    }
    // Follow `has_more`, not the page count: the table grows, MAX_PAGES only
    // bounds how far a sync will chase it.
    if (asRecord(body.pagination).has_more !== true) break;
  }
  return {
    meta: {
      fetchedAt: new Date().toISOString(),
      indexVersion,
      tier,
      modelCount: rows.length,
    },
    byNormName: indexAaModels(rows),
  };
}

// Which AA row represents a base name when several classified rows share one:
// the plain row (full key == base) beats a classified one, and a non-reasoning
// row beats a reasoning one — the conservative default for a catalog id that
// names no configuration ("gemini-2.5-flash" is the ordinary flash, not its
// reasoning mode).
function classificationRank(fullKey: string, baseKey: string): number {
  if (fullKey === baseKey) return 2;
  return fullKey.includes("nonreasoning") ? 1 : 0;
}

/**
 * Full key → row (exact matching) plus base key → best representative row
 * (fallback for catalog ids without the classification suffix). Rows carry
 * their `name`, so the index can always be rebuilt from what the snapshot
 * stored — a snapshot written before the base keys existed still matches.
 */
export function indexAaModels(models: AaModelMetrics[]): Record<string, AaModelMetrics> {
  const byNormName: Record<string, AaModelMetrics> = {};
  const fullNameKeys = new Set<string>();
  for (const model of models) {
    const key = normalizeModelName(model.name);
    if (!key) continue;
    fullNameKeys.add(key);
    if (!(key in byNormName)) byNormName[key] = model;
    const base = baseModelName(model.name);
    if (!base || base === key) continue;
    const current = byNormName[base];
    if (!current || classificationRank(key, base) > classificationRank(normalizeModelName(current.name), base)) {
      byNormName[base] = model;
    }
  }
  // AA files a model's default configuration under the unsuffixed slug
  // ("gpt-5-6-luna" is Luna at Max) and every other config under a suffixed
  // one. That beats the non-reasoning guess above for a catalog id that names
  // no configuration — the guess put GPT-5.6 Luna at intel 15.5 instead of
  // 37.3. A row's own full-name key is never overwritten.
  for (const model of models) {
    const slugKey = normalizeModelName(model.slug);
    if (slugKey && !fullNameKeys.has(slugKey)) byNormName[slugKey] = model;
  }
  return byNormName;
}

async function loadStaleSnapshot(): Promise<AaSnapshot | null> {
  try {
    const meta = await getAaSnapshotMeta();
    if (!meta) return null;
    // Re-index instead of trusting the stored keys: a snapshot written before
    // the base keys existed still matches without waiting for the next sync.
    return { meta, byNormName: indexAaModels(Object.values(await getAaModels())) };
  } catch {
    return null;
  }
}

async function loadOrSyncSnapshot(): Promise<AaSnapshot | null> {
  try {
    const meta = await getAaSnapshotMeta();
    if (meta && Number.isFinite(Date.parse(meta.fetchedAt)) && Date.now() - Date.parse(meta.fetchedAt) < SYNC_TTL_MS) {
      return { meta, byNormName: indexAaModels(Object.values(await getAaModels())) };
    }
    // No key: the feature is off. Not an error and not a warning — the
    // suggestion keeps working on deterministic data alone.
    const apiKey = process.env.ARTIFICIAL_ANALYSIS_API_KEY?.trim();
    if (!apiKey) return null;
    const snapshot = await fetchAaSnapshot(apiKey);
    await saveAaSnapshot(snapshot.meta, snapshot.byNormName);
    return snapshot;
  } catch (error) {
    // Fail-open: a dead sync must never break a suggestion. The message is
    // sanitized on purpose — errors can echo the URL, never the key.
    console.error("Artificial Analysis sync failed (fail-open):", error instanceof Error ? error.message : String(error));
    return loadStaleSnapshot();
  }
}

// Single-flight: concurrent suggest/profiles calls share one sync instead of
// firing duplicate fetches at a 100-requests/day endpoint. Cleared on settle,
// so the next stale check starts a genuinely new request.
let inflight: Promise<AaSnapshot | null> | null = null;

export async function syncAaSnapshotIfStale(): Promise<AaSnapshot | null> {
  if (inflight) return inflight;
  inflight = loadOrSyncSnapshot().finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * The operator asked for a fresh snapshot: skip the daily TTL. Unlike the
 * automatic path this does not fall back to the stale snapshot — a button that
 * reports success while nothing was fetched is worse than an error. The stored
 * snapshot is only replaced after a complete fetch.
 */
export async function forceSyncAaSnapshot(): Promise<AaSnapshot> {
  const apiKey = process.env.ARTIFICIAL_ANALYSIS_API_KEY?.trim();
  if (!apiKey) throw new Error("ARTIFICIAL_ANALYSIS_API_KEY is not configured");
  const snapshot = await fetchAaSnapshot(apiKey);
  await saveAaSnapshot(snapshot.meta, snapshot.byNormName);
  return snapshot;
}

/** AA metrics for one profile: the model id first, then the display name. */
export function matchAaToProfile(
  profile: SmartModelProfile,
  byNormName: Record<string, AaModelMetrics>,
): AaModelMetrics | undefined {
  // Provider-prefixed ids ("anthropic/claude-sonnet-4-5") rarely normalize to
  // an AA name, but the display name usually does — try both, then the bare id
  // and its canonical key (no prefix, no ":free", no dated snapshot).
  const bare = String(profile.model ?? "").split("/").pop()?.split(":")[0] ?? "";
  for (const candidate of [profile.model, profile.displayName, bare, canonicalModelKey(profile.model)]) {
    const key = normalizeModelName(candidate);
    const base = baseModelName(candidate);
    // The candidate names an explicit AA variant ("Gemini 2.5 Flash
    // (Non-reasoning)"): the exact row wins and no preference is applied.
    if (key && key !== base && key in byNormName) return byNormName[key];
    if (!base) continue;
    // Unqualified catalog id: a reasoning-column model measures against AA's
    // reasoning configuration of the same base ("...reasoning") when there is
    // one, before the base entry the index kept as fallback.
    if (profile.recommendedTier === "reasoning") {
      const reasoning = byNormName[`${base}reasoning`];
      if (reasoning) return reasoning;
    }
    if (key && key in byNormName) return byNormName[key];
    if (base in byNormName) return byNormName[base];
  }
  return undefined;
}

/**
 * Attach AA metrics to the profiles that match. Prices are only ever *filled*:
 * AA is an aggregated reference, and the operator override / static catalog
 * price that billing uses always wins over it.
 */
export function enrichProfilesWithAa(
  profiles: SmartModelProfile[],
  snapshot: AaSnapshot | null,
): { profiles: SmartModelProfile[]; matched: number; total: number } {
  const total = profiles.length;
  // No snapshot (feature off or sync failed): everything stays exactly as it
  // was. matched 0 also tells the caller generic web research is still needed.
  if (!snapshot) return { profiles, matched: 0, total };
  let matched = 0;
  const enriched = profiles.map((profile) => {
    const aa = matchAaToProfile(profile, snapshot.byNormName);
    if (!aa) return profile;
    matched += 1;
    return {
      ...profile,
      aa,
      inputPrice: profile.inputPrice ?? aa.inputUsdPer1M,
      outputPrice: profile.outputPrice ?? aa.outputUsdPer1M,
    };
  });
  return { profiles: enriched, matched, total };
}

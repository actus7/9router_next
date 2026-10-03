import "server-only";

import { handleSingleModelChat } from "@/server/llm-gateway/chat";
import { handleSearch } from "@/server/llm-gateway/search";
import {
  attachAaScoresAndReasons,
  refreshDeterministicSmartProfiles,
  type AaSnapshotMeta,
  type SmartModelProfile,
} from "@/server/llm-gateway/smart-routing";
import { currentTenantId, withTenant } from "@/lib/db/tenant";
import { getSuggestions, saveSuggestions, type CachedSuggestion } from "@/lib/db/repos/suggestCacheRepo";
import { enrichProfilesWithAa, syncAaSnapshotIfStale } from "./artificialAnalysis";
import {
  jevSuggestionOverrides,
  overlayJevSuggestion,
  type JevSuggestionOverride,
} from "./suggestJev";

/**
 * "Suggest models with AI": the whole orchestration behind
 * POST /api/smart-routing/suggest, streaming progress as NDJSON.
 *
 * Stream contract (one JSON object per `\n`-terminated line, in this order):
 *   {"type":"phase","phase":"aa-sync"}
 *   {"type":"phase","phase":"inventory","total":n,"llmEligible":n}
 *   {"type":"cache","cached":n,"toAnalyze":n,"skippedByLimit":n}
 *   {"type":"phase","phase":"web-research","used":bool}
 *   {"type":"batch","index":n,"total":n,"analyzed":["alias/model",...]}  (after each LLM batch)
 *   {"type":"done","payload":{...the endpoint's original JSON body...}}
 *   {"type":"error","message":"..."}  (terminal; nothing follows)
 * Any failure is reported as the terminal error event — the stream itself is
 * not fail-open; the client decides what to do with the failure. Individual
 * subsystems (AA sync, web research, Jev, one batch of the classifier) stay
 * fail-open per their own contracts.
 */

const BATCH_SIZE = 30;
// The cache amortizes the classifier cost across runs: a re-run only analyzes
// what changed. The first run is still bounded at 12 batches of 30.
export const MAX_PROFILES = 360;
export const SUGGEST_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SuggestRequestBody {
  webResearch?: boolean;
  classifierModel?: string;
  modelKeys?: string[];
  force?: boolean;
}

export interface SuggestDonePayload {
  profiles: SmartModelProfile[];
  classifierModel: string;
  researchedAt: string;
  researchProvider: string | null;
  webResearchUsed: boolean;
  totalInventory: number;
  included: number;
  truncated: boolean;
  aaMeta: (AaSnapshotMeta & { matchedCount: number }) | null;
}

type SuggestStreamEvent =
  | { type: "phase"; phase: "aa-sync" }
  | { type: "phase"; phase: "inventory"; total: number; llmEligible: number }
  | { type: "cache"; cached: number; toAnalyze: number; skippedByLimit: number }
  | { type: "phase"; phase: "web-research"; used: boolean }
  | { type: "batch"; index: number; total: number; analyzed: string[] }
  | { type: "done"; payload: SuggestDonePayload }
  | { type: "error"; message: string };

// FNV-1a 32 bits, same recipe as stableFingerprint in the smart-routing
// inventory: a stable 8-hex-char digest for fingerprinting.
function stableFingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** JSON with object keys sorted, so the digest does not depend on key order. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * The cache's `aaFingerprint` for a profile: a digest of the AA metrics it was
 * analyzed against, or null when it had none. Two enrichments matching on the
 * same numbers compare equal no matter how the objects were built.
 */
export function aaFingerprintOf(profile: SmartModelProfile): string | null {
  return profile.aa ? stableFingerprint(canonicalJson(profile.aa)) : null;
}

export interface CachedProfileHit {
  profile: SmartModelProfile;
  cached: CachedSuggestion;
}

/**
 * Splits targets into cache hits and profiles to (re-)analyze.
 *
 * A hit must agree with the profile on everything that fed the suggestion —
 * age (TTL), the inventory fingerprint the profile already carries, and the AA
 * metrics digest — otherwise the suggestion is stale and goes back to the
 * classifier. `force` is deliberately not this function's concern: a forced run
 * arrives here as an empty cache.
 */
export function partitionByCache(
  targets: SmartModelProfile[],
  cache: Record<string, CachedSuggestion>,
  opts: { now: number; ttlMs: number },
): { fresh: CachedProfileHit[]; stale: SmartModelProfile[] } {
  const fresh: CachedProfileHit[] = [];
  const stale: SmartModelProfile[] = [];
  for (const profile of targets) {
    const cached = cache[profile.modelKey];
    const analyzedAt = cached ? Date.parse(cached.analyzedAt) : NaN;
    if (
      cached !== undefined
      && Number.isFinite(analyzedAt)
      && analyzedAt + opts.ttlMs > opts.now
      && cached.inventoryFingerprint === profile.inventoryFingerprint
      && cached.aaFingerprint === aaFingerprintOf(profile)
    ) {
      fresh.push({ profile, cached });
    } else {
      stale.push(profile);
    }
  }
  return { fresh, stale };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function responseText(payload: unknown): string {
  const root = asRecord(payload);
  const choice = Array.isArray(root.choices) ? asRecord(root.choices[0]) : {};
  const message = asRecord(choice.message);
  if (typeof message.content === "string") return message.content;
  const content = Array.isArray(root.content) ? asRecord(root.content[0]) : {};
  if (typeof content.text === "string") return content.text;
  if (Array.isArray(root.output)) {
    for (const item of root.output) {
      const blocks = asRecord(item).content;
      if (!Array.isArray(blocks)) continue;
      const block = blocks.map(asRecord).find((candidate) => typeof candidate.text === "string");
      if (typeof block?.text === "string") return block.text;
    }
  }
  return "";
}

function parseSuggestions(payload: unknown): Array<Record<string, unknown>> {
  const text = responseText(payload);
  try {
    const parsed: unknown = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""));
    const values = Array.isArray(parsed) ? parsed : asRecord(parsed).profiles;
    return Array.isArray(values) ? values.map(asRecord) : [];
  } catch {
    return [];
  }
}

function chooseClassifier(profiles: SmartModelProfile[], requested?: string): SmartModelProfile | null {
  if (requested) {
    const explicit = profiles.find((profile) => profile.modelKey === requested && profile.capabilities.serviceKinds.includes("llm"));
    if (explicit) return explicit;
  }
  return profiles
    .filter((profile) => profile.capabilities.serviceKinds.includes("llm"))
    .sort((a, b) => {
      const aScore = a.quality + (a.capabilities.search ? 0.08 : 0) + a.reliabilityScore * 0.15;
      const bScore = b.quality + (b.capabilities.search ? 0.08 : 0) + b.reliabilityScore * 0.15;
      return bScore - aScore;
    })[0] || null;
}

async function researchInventory(request: Request, profiles: SmartModelProfile[]): Promise<{ evidence: string; provider?: string }> {
  const searchProfile = profiles.find((profile) => profile.capabilities.serviceKinds.includes("webSearch"));
  if (!searchProfile) return { evidence: "" };
  const names = profiles.slice(0, 60).map((profile) => profile.model).join(", ");
  const headers = new Headers({ "content-type": "application/json", accept: "application/json" });
  const authorization = request.headers.get("authorization");
  if (authorization) headers.set("authorization", authorization);
  try {
    const response = await handleSearch(new Request("http://localhost/v1/search", {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider: searchProfile.provider,
        query: `Find official or primary documentation about capabilities, context limits, pricing, and intended use for these AI models: ${names}`,
        max_results: 10,
      }),
    }));
    if (!response.ok) return { evidence: "" };
    return { evidence: (await response.text()).slice(0, 16_000), provider: searchProfile.provider };
  } catch {
    return { evidence: "" };
  }
}

async function classifyBatch(classifier: SmartModelProfile, batch: SmartModelProfile[], evidence: string): Promise<Array<Record<string, unknown>>> {
  const compact = batch.map((profile) => ({
    modelKey: profile.modelKey,
    capabilities: profile.capabilities,
    inputPrice: profile.inputPrice,
    outputPrice: profile.outputPrice,
    deterministicQuality: profile.quality,
    deterministicTier: profile.recommendedTier,
    // AA metrics ride with the model so the classifier calibrates on measured
    // numbers instead of family reputation.
    ...(profile.aa ? { aa: { intel: profile.aa.intelligence, code: profile.aa.coding, agentic: profile.aa.agentic, in: profile.aa.inputUsdPer1M, out: profile.aa.outputUsdPer1M, tps: profile.aa.outputTokensPerSecond, ttft: profile.aa.ttftSeconds } } : {}),
  }));
  const prompt = [
    "You profile AI models for a production smart router. Return JSON only: an array with exactly one object per modelKey.",
    'Each object: {"modelKey":string,"quality":0..1,"latencyScore":0..1,"reliabilityScore":0..1,"recommendedTier":"simple|standard|complex|reasoning","needScores":object,"sources":string[]}.',
    "Tier rubric (choose exactly ONE tier per model — never duplicate a model across tiers):",
    "simple: cheap and fast responders — lowest blended price, high tokens/s, low TTFT; quality is acceptable at 0.3-0.55. Never place reasoning-focused models here.",
    "standard: best cost/quality balance for everyday multi-step work; versatile generalists, quality 0.5-0.75.",
    "complex: hardest work, especially code and multi-step agentic tasks — prioritize coding/agentic/intelligence indices; higher price and latency are acceptable, quality 0.7-0.95.",
    "reasoning: ONLY models with explicit reasoning/thinking capability (family knowledge or naming); formal math/logic/planning; quality 0.75-1. When in doubt prefer complex, do not fill this lane just to fill it.",
    "Ordering matters: your scores decide the order inside each tier — score the tier's objective higher (e.g. speed+price for simple, capability for complex/reasoning).",
    "artificialAnalysis metrics when present are ground truth (indices 0-100, USD/1M prices, tokens/s, TTFT): calibrate quality from them (complex weights coding/agentic, reasoning weights intelligence/agentic), latencyScore from speed/TTFT. Without metrics be conservative (quality near the deterministic value) and rely on well-established model-family facts only.",
    "Sources: when AA metrics were used include https://artificialanalysis.ai; from web evidence include the URL; [] otherwise.",
    `Models: ${JSON.stringify(compact)}`,
    evidence ? `Web research evidence: ${evidence}` : "No web research provider was available; make conservative suggestions.",
  ].join("\n");
  const body: Record<string, unknown> = {
    model: classifier.modelKey,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 8_000,
    stream: false,
  };
  const rawRequest = {
    endpoint: "/v1/chat/completions",
    body,
    headers: { accept: "application/json", "x-router-internal": "profile-suggestion" },
  };
  const response = await handleSingleModelChat(body, classifier.modelKey, rawRequest, null, null);
  if (!response.ok) return [];
  return parseSuggestions(await response.json());
}

function finiteScore(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
}

/**
 * What goes back to the cache for one analyzed model: the six suggestion
 * fields coerced to their declared shapes (the classifier writes free-form
 * JSON), with the profile's deterministic values as fallback and the Jev
 * verdict baked into `recommendedTier` so a cache hit replays this run's
 * result. Jev's dominant-need label is transient and not cached.
 */
function toCachedSuggestion(
  profile: SmartModelProfile,
  raw: Record<string, unknown> | undefined,
  override: JevSuggestionOverride | undefined,
): CachedSuggestion["suggestion"] {
  const source = raw || {};
  const rawNeeds = source.needScores && typeof source.needScores === "object"
    ? source.needScores as Record<string, unknown>
    : profile.needScores;
  const needScores: Record<string, number> = {};
  for (const [need, score] of Object.entries(rawNeeds)) {
    const parsed = typeof score === "number" ? score : Number(score);
    if (Number.isFinite(parsed)) needScores[need] = parsed;
  }
  return {
    quality: finiteScore(source.quality, profile.quality),
    latencyScore: finiteScore(source.latencyScore, profile.latencyScore),
    reliabilityScore: finiteScore(source.reliabilityScore, profile.reliabilityScore),
    recommendedTier: override?.tier
      ?? (typeof source.recommendedTier === "string" && source.recommendedTier ? source.recommendedTier : profile.recommendedTier),
    needScores,
    sources: Array.isArray(source.sources) ? source.sources.filter((entry): entry is string => typeof entry === "string") : [],
  };
}

/** An error message fit for the wire: no braces, so no JSON fragment leaks. */
function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const cleaned = message.replace(/[{}]/g, "").trim();
  return cleaned || "Failed to suggest model profiles";
}

async function loadSuggestionCache(): Promise<Record<string, CachedSuggestion>> {
  try {
    return await getSuggestions();
  } catch (error) {
    // Fail-open: the cache is an optimization. A read that failed only means
    // this run analyzes everything and writes it back.
    console.error("Suggestion cache read failed (fail-open):", error instanceof Error ? error.message : String(error));
    return {};
  }
}

async function* runSuggest(request: Request, body: SuggestRequestBody): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  const emit = (event: SuggestStreamEvent): Uint8Array => encoder.encode(`${JSON.stringify(event)}\n`);
  try {
    // Emitted before anything is awaited: the stream answers immediately and
    // the client sees the phase while the inventory is still loading.
    yield emit({ type: "phase", phase: "aa-sync" });
    // Artificial Analysis enrichment: measured benchmarks/prices where the
    // catalog has none. Fail-open — a missing snapshot changes nothing.
    const aa = await syncAaSnapshotIfStale();
    const inventory = await refreshDeterministicSmartProfiles();
    // This endpoint only feeds general-purpose LLM chat routing (ComplexityRoutingBoard tiers);
    // non-chat models (TTS voices, STT, image/video, embeddings) from noAuth providers must not
    // pollute the suggestions.
    const llmInventory = inventory.filter((profile) => profile.capabilities.serviceKinds.includes("llm"));
    const enriched = enrichProfilesWithAa(llmInventory, aa);
    yield emit({ type: "phase", phase: "inventory", total: inventory.length, llmEligible: llmInventory.length });

    const requestedKeys = body.modelKeys ? new Set(body.modelKeys) : null;
    const candidates = enriched.profiles.filter((profile) => !requestedKeys || requestedKeys.has(profile.modelKey));
    const targets = candidates.slice(0, MAX_PROFILES);
    if (targets.length === 0) {
      yield emit({ type: "error", message: "No active models selected" });
      return;
    }
    const classifier = chooseClassifier(inventory, body.classifierModel);
    if (!classifier) {
      yield emit({ type: "error", message: "No active LLM is available to suggest profiles" });
      return;
    }

    // force === true re-analyzes everything and overwrites below.
    const cache = body.force ? {} : await loadSuggestionCache();
    const { fresh, stale } = partitionByCache(targets, cache, { now: Date.now(), ttlMs: SUGGEST_CACHE_TTL_MS });
    yield emit({
      type: "cache",
      cached: fresh.length,
      toAnalyze: stale.length,
      skippedByLimit: Math.max(0, candidates.length - MAX_PROFILES),
    });

    // Structured AA evidence replaces generic web research once half the
    // inventory matched: it is ground truth, and the search round-trip is pure
    // latency. Below 0.5 the old behaviour stands. `used` is the decision (the
    // phase is a progress marker), not whether the search returned evidence.
    const aaCoversInventory = aa !== null && enriched.total > 0 && enriched.matched / enriched.total >= 0.5;
    const researchWanted = body.webResearch !== false && !aaCoversInventory;
    yield emit({ type: "phase", phase: "web-research", used: researchWanted });
    const research = researchWanted ? await researchInventory(request, targets) : { evidence: "" };

    // The hybrid: Jev answers the typed categories (tier, dominant need) for a
    // whole batch in one call and the LLM keeps the numeric scores it wrote —
    // see suggestJev. No Jev verdict and everything stays as the LLM said.
    const suggestions: Array<Record<string, unknown>> = [];
    const jevOverrides = new Map<string, JevSuggestionOverride>();
    const totalBatches = Math.ceil(stale.length / BATCH_SIZE);
    let batchIndex = 0;
    for (let offset = 0; offset < stale.length; offset += BATCH_SIZE) {
      const batch = stale.slice(offset, offset + BATCH_SIZE);
      batchIndex += 1;
      suggestions.push(...await classifyBatch(classifier, batch, research.evidence));
      yield emit({ type: "batch", index: batchIndex, total: totalBatches, analyzed: batch.map((profile) => profile.modelKey) });
      const judged = await jevSuggestionOverrides(batch.map((profile) => ({
        modelKey: profile.modelKey,
        description: profile.displayName,
        pricing: { inputPrice: profile.inputPrice, outputPrice: profile.outputPrice },
        deterministicTier: profile.recommendedTier,
      })));
      for (const [modelKey, override] of judged) jevOverrides.set(modelKey, override);
    }

    const suggestionByKey = new Map<string, Record<string, unknown>>();
    // Cache hits replay exactly what classifyBatch would have returned.
    for (const hit of fresh) suggestionByKey.set(hit.profile.modelKey, { ...hit.cached.suggestion });
    for (const suggestion of suggestions) suggestionByKey.set(String(suggestion.modelKey || ""), suggestion);
    // Targets keep their inventory order (fresh and stale interleaved).
    const preview = targets.map((profile) => overlayJevSuggestion(
      { ...profile, ...(suggestionByKey.get(profile.modelKey) || {}), modelKey: profile.modelKey },
      jevOverrides.get(profile.modelKey),
    ));

    // New analyses land in the cache with the fingerprints they were produced
    // under; the fresh rows are kept as they are (not rewritten). A model whose
    // batch produced no suggestion stays stale and is retried next run.
    const analyzedAt = new Date().toISOString();
    const freshKeys = new Set(fresh.map((hit) => hit.profile.modelKey));
    const entries: Record<string, CachedSuggestion> = {};
    for (const profile of targets) {
      const raw = suggestionByKey.get(profile.modelKey);
      if (freshKeys.has(profile.modelKey) || !raw) continue;
      entries[profile.modelKey] = {
        analyzedAt,
        inventoryFingerprint: profile.inventoryFingerprint,
        aaFingerprint: aaFingerprintOf(profile),
        suggestion: toCachedSuggestion(profile, raw, jevOverrides.get(profile.modelKey)),
      };
    }
    try {
      await saveSuggestions(entries);
    } catch (error) {
      // Fail-open: a lost write only means the next run analyzes again.
      console.error("Suggestion cache write failed (fail-open):", error instanceof Error ? error.message : String(error));
    }

    // Scores and reason lines land after the Jev overlay: what the board orders
    // by is exactly what the operator sees in the preview.
    const scored = attachAaScoresAndReasons(preview);
    yield emit({
      type: "done",
      payload: {
        profiles: scored.profiles,
        classifierModel: classifier.modelKey,
        researchedAt: analyzedAt,
        researchProvider: research.provider || null,
        webResearchUsed: !!research.evidence,
        totalInventory: llmInventory.length,
        included: preview.length,
        truncated: targets.length < candidates.length,
        aaMeta: aa ? { ...aa.meta, matchedCount: enriched.matched } : null,
      },
    });
  } catch (error) {
    console.error("Error suggesting smart model profiles:", error);
    yield emit({ type: "error", message: sanitizeErrorMessage(error) });
  }
}

/**
 * The NDJSON stream for the suggest endpoint. Everything happens inside the
 * stream so the first phase marker reaches the client before the inventory is
 * even loaded.
 */
export function streamSuggestSuggestions(request: Request, body: SuggestRequestBody): ReadableStream<Uint8Array> {
  // Captured here, inside tenantRoute's scope. The generator below resumes
  // after every await from the stream's consumer, where the ambient tenant is
  // whoever happens to be reading — so the work is re-scoped to the account
  // that opened the stream, the way usage/stream does it.
  const owner = currentTenantId();
  const events = runSuggest(request, body);
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await withTenant(owner, async () => {
          for await (const chunk of events) {
            controller.enqueue(chunk);
          }
        });
      } catch {
        // Consumer went away mid-write; the stream is over either way.
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by the consumer.
        }
      }
    },
    cancel() {
      void events.return(undefined);
    },
  });
}

import "server-only";

// Jev (TypeSafe AI) answers typed questions — boolean, choice, score — with
// calibrated probabilities instead of text. Two ways in, both set up in the
// profile's decision-engine card: TypeSafe's own API, with a key from
// console.typesafe.ai saved on the account (decisionKeysRepo, encrypted), and
// otherwise the Vercel AI Gateway, whose credential is the account's
// `vercel-ai-gateway` connection or `AI_GATEWAY_API_KEY`.
//
// Every caller treats Jev as an optional upgrade over a heuristic it already
// has. So this module never throws: no key, a timeout, a non-2xx or a shape we
// do not recognise all come back as null, and the caller keeps its heuristic.

import { getProviderConnections } from "@/lib/db/repos/connectionsRepo";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { currentTenantId } from "@/lib/db/tenant";
import { getTypesafeKey } from "@/lib/db/repos/decisionKeysRepo";

export const JEV_MODEL = "typesafe-ai/jev";
const JEV_URL = "https://ai-gateway.vercel.sh/v1/evaluate";
const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
// TypeSafe names its models without the gateway's provider prefix, and Jev
// itself is `jev-latest` there.
const TYPESAFE_DEFAULT_MODEL = "jev-latest";
const JEV_CONNECTION_PROVIDER = "vercel-ai-gateway";
// Vercel documents 32k tokens for `state`; ~4 chars per token keeps us inside.
const MAX_STATE_CHARS = 100_000;

export type JevQuestion =
  | { type: "boolean"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type JevAnswer =
  | { type: "boolean"; probability: number }
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "score"; score: number; confidence: number; probabilities: Record<string, number> };

export type JevFeature =
  | "smartRouting"
  | "memoryReview"
  | "pluginSelection"
  | "writeRisk"
  | "errorClassification"
  | "guardrails"
  | "skillScan"
  | "loopControl"
  | "delegateModel"
  | "rerank"
  | "inventory"
  | "suggestRouting"
  | "usageTaxonomy";

export const JEV_FEATURE_SETTING: Record<JevFeature, string> = {
  smartRouting: "jevSmartRouting",
  memoryReview: "jevMemoryReview",
  pluginSelection: "jevPluginSelection",
  writeRisk: "jevWriteRisk",
  errorClassification: "jevErrorClassification",
  guardrails: "jevGuardrails",
  skillScan: "jevSkillScan",
  loopControl: "jevLoopControl",
  delegateModel: "jevDelegateModel",
  rerank: "jevRerank",
  inventory: "jevInventory",
  suggestRouting: "jevSuggestRouting",
  usageTaxonomy: "jevUsageTaxonomy",
};

// `getSettings()` is a database read, and the decision features ask once per
// decision — several per request. Settings change rarely, so the answer is held
// for 30s. Keyed by tenant: settings are per account through AsyncLocalStorage,
// and one account's flags must never answer another's question.
const SETTINGS_CACHE_TTL_MS = 30_000;
type JevSettings = Awaited<ReturnType<typeof getSettings>>;
const settingsCache = new Map<string, { at: number; value: JevSettings }>();

function settingsCacheKey(): string {
  try {
    return currentTenantId();
  } catch {
    // Unscoped caller (a test): one shared bucket is safe, nothing cross-tenant.
    return "";
  }
}

/** Test hook: the 30s TTL would otherwise outlive a settings change. */
export function resetJevSettingsCache(): void {
  settingsCache.clear();
}

async function cachedSettings(): Promise<JevSettings> {
  const key = settingsCacheKey();
  const hit = settingsCache.get(key);
  if (hit && Date.now() - hit.at < SETTINGS_CACHE_TTL_MS) return hit.value;
  const value = await getSettings();
  settingsCache.set(key, { at: Date.now(), value });
  return value;
}

export async function isJevFeatureEnabled(feature: JevFeature): Promise<boolean> {
  try {
    const settings = await cachedSettings();
    return settings.decisionEngine === "jev" && settings[JEV_FEATURE_SETTING[feature]] === true;
  } catch {
    return false;
  }
}

export async function getJevApiKey(): Promise<string | null> {
  // The environment key wins when present: the decision engine then works with
  // no `vercel-ai-gateway` connection row at all. The account's connection
  // stays the fallback, so nothing that works today breaks.
  const envKey = process.env.AI_GATEWAY_API_KEY?.trim();
  if (envKey) return envKey;
  const connections = await getProviderConnections({ provider: JEV_CONNECTION_PROVIDER, isActive: true });
  const key = connections.map((connection) => connection.apiKey).find((value) => typeof value === "string" && value.trim());
  return typeof key === "string" ? key.trim() : null;
}

interface JevEndpoint {
  url: string;
  apiKey: string;
  direct: boolean;
}

/** Where a Jev call goes and with which key: the account's TypeSafe key wins over the gateway. */
async function jevEndpoint(typesafeKey?: string): Promise<JevEndpoint | null> {
  // A failed read of the TypeSafe key must not take the gateway path down with it.
  const direct = typesafeKey ?? (await getTypesafeKey().catch(() => null));
  if (direct) return { url: TYPESAFE_URL, apiKey: direct, direct: true };
  const gatewayKey = await getJevApiKey();
  return gatewayKey ? { url: JEV_URL, apiKey: gatewayKey, direct: false } : null;
}

function modelFor(endpoint: JevEndpoint, model: string): string {
  if (!endpoint.direct) return model;
  const bare = model.replace(/^typesafe-ai\//, "");
  return bare === "jev" ? TYPESAFE_DEFAULT_MODEL : bare;
}

// TypeSafe's own API calls the yes/no question `noul`; the gateway says `boolean`.
function questionsFor(endpoint: JevEndpoint, questions: Record<string, JevQuestion>): Record<string, unknown> {
  if (!endpoint.direct) return questions;
  return Object.fromEntries(
    Object.entries(questions).map(([id, q]) => [id, q.type === "boolean" ? { ...q, type: "noul" } : q]),
  );
}

async function postJev(endpoint: JevEndpoint, model: string, state: unknown, questions: Record<string, JevQuestion>, timeoutMs: number): Promise<Response> {
  return fetch(endpoint.url, {
    method: "POST",
    headers: { authorization: `Bearer ${endpoint.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: modelFor(endpoint, model), state, questions: questionsFor(endpoint, questions) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function probabilityMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, p]) => isProbability(p))) as Record<string, number>;
}

// The raw HTTP answer may or may not carry `confidence` (the AI SDK surfaces it
// as provider metadata). The top probability is the honest stand-in.
function confidenceOf(raw: Record<string, unknown>, probabilities: Record<string, number>): number {
  if (isProbability(raw.confidence)) return raw.confidence;
  const values = Object.values(probabilities);
  return values.length ? Math.max(...values) : 0;
}

function parseAnswer(raw: unknown, question: JevQuestion): JevAnswer | null {
  if (!raw || typeof raw !== "object") return null;
  const answer = raw as Record<string, unknown>;
  if (question.type === "boolean") {
    const probability = answer.probability ?? answer.boolean ?? answer.noul;
    return isProbability(probability) ? { type: "boolean", probability } : null;
  }
  const probabilities = probabilityMap(answer.probabilities);
  if (question.type === "choice") {
    const choice = answer.choice;
    if (typeof choice !== "string" || !Object.hasOwn(question.criteria, choice)) return null;
    return { type: "choice", choice, probabilities, confidence: confidenceOf(answer, probabilities) };
  }
  const score = answer.score;
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  return { type: "score", score, probabilities, confidence: confidenceOf(answer, probabilities) };
}

export async function evaluateJev<Q extends Record<string, JevQuestion>>(
  state: string | Record<string, unknown>,
  questions: Q,
  timeoutMs: number,
  // Any System One model the gateway serves; Jev unless a caller picked another.
  model: string = JEV_MODEL,
): Promise<{ [K in keyof Q]: JevAnswer } | null> {
  try {
    const endpoint = await jevEndpoint();
    if (!endpoint) return null;
    const boundedState = typeof state === "string" ? state.slice(0, MAX_STATE_CHARS) : state;
    const response = await postJev(endpoint, model, boundedState, questions, timeoutMs);
    if (!response.ok) return null;
    const payload = (await response.json()) as { answers?: Record<string, unknown> };
    const answers: Record<string, JevAnswer> = {};
    for (const [id, question] of Object.entries(questions)) {
      const parsed = parseAnswer(payload?.answers?.[id], question);
      if (!parsed) return null;
      answers[id] = parsed;
    }
    return answers as { [K in keyof Q]: JevAnswer };
  } catch {
    return null;
  }
}

export type JevDecision<Q extends Record<string, JevQuestion>> = {
  answers: { [K in keyof Q]: JevAnswer };
  source: "jev";
};

/**
 * Jev-first: returns null whenever the caller must fall back to its heuristic
 * (feature off, no key, timeout, non-2xx, unrecognised shape). Never throws.
 *
 * Confidence is NOT filtered here — each caller holds `answers.X.confidence`
 * (or a boolean's probability) to the threshold its own decision needs.
 */
export async function decideWithJev<Q extends Record<string, JevQuestion>>(
  feature: JevFeature,
  state: string | Record<string, unknown>,
  questions: Q,
  options: { timeoutMs: number },
): Promise<JevDecision<Q> | null> {
  try {
    if (!(await isJevFeatureEnabled(feature))) return null;
    const answers = await evaluateJev(state, questions, options.timeoutMs);
    return answers ? { answers, source: "jev" } : null;
  } catch {
    return null;
  }
}

export type JevProbeResult =
  | { ok: true; latencyMs: number }
  | { ok: false; reason: "no_key" | "free_tier" | "unauthorized" | "http" | "timeout" | "shape"; status?: number; message: string };

const PROBE_QUESTION = { ping: { type: "boolean", instructions: "Is this a greeting?" } } as const;

/**
 * One tiny Jev call that says *why* it failed. `evaluateJev` swallows every
 * failure so callers keep their heuristic — which also made a broken setup
 * invisible: a free-tier Vercel account answers 403 on every call while the
 * profile card still read "using your key". The card's test button uses this.
 */
export async function probeJev(timeoutMs = 15_000, candidate?: { typesafeKey: string }): Promise<JevProbeResult> {
  // A candidate key is tried before it is saved (the card's TypeSafe form).
  const endpoint = await jevEndpoint(candidate?.typesafeKey).catch(() => null);
  if (!endpoint) return { ok: false, reason: "no_key", message: "No Jev key on this account: add a TypeSafe key or a Vercel AI Gateway connection." };
  const apiKey = endpoint.apiKey;
  const startedAt = Date.now();
  try {
    const response = await postJev(endpoint, JEV_MODEL, "hello", PROBE_QUESTION, timeoutMs);
    const payload = (await response.json().catch(() => ({}))) as { answers?: Record<string, unknown>; error?: { message?: string } };
    // The upstream message can quote the request; never hand the key back.
    const message = String(payload?.error?.message || `HTTP ${response.status}`).replaceAll(apiKey, "***").slice(0, 300);
    if (response.status === 401 || (endpoint.direct && response.status === 403)) return { ok: false, reason: "unauthorized", status: response.status, message };
    if (response.status === 403 && /free tier/i.test(message)) return { ok: false, reason: "free_tier", status: 403, message };
    if (!response.ok) return { ok: false, reason: "http", status: response.status, message };
    if (!parseAnswer(payload?.answers?.ping, PROBE_QUESTION.ping)) {
      return { ok: false, reason: "shape", status: response.status, message: "Jev answered in an unrecognised shape." };
    }
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { ok: false, reason: timedOut ? "timeout" : "http", message: timedOut ? "Jev did not answer in time." : endpoint.direct ? "Could not reach api.typesafe.ai." : "Could not reach the Vercel AI Gateway." };
  }
}

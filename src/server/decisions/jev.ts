import "server-only";

// Jev (TypeSafe AI) answers typed questions — boolean, choice, score — with
// calibrated probabilities instead of text. We reach it through the Vercel AI
// Gateway, so the account's existing `vercel-ai-gateway` connection is the
// credential: no second key to store, and billing stays on the user's gateway.
//
// Every caller treats Jev as an optional upgrade over a heuristic it already
// has. So this module never throws: no key, a timeout, a non-2xx or a shape we
// do not recognise all come back as null, and the caller keeps its heuristic.

import { getProviderConnections } from "@/lib/db/repos/connectionsRepo";
import { getSettings } from "@/lib/db/repos/settingsRepo";

export const JEV_MODEL = "typesafe-ai/jev";
const JEV_URL = "https://ai-gateway.vercel.sh/v1/evaluate";
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

export type JevFeature = "smartRouting" | "memoryReview" | "pluginSelection" | "writeRisk";

export const JEV_FEATURE_SETTING: Record<JevFeature, string> = {
  smartRouting: "jevSmartRouting",
  memoryReview: "jevMemoryReview",
  pluginSelection: "jevPluginSelection",
  writeRisk: "jevWriteRisk",
};

export async function isJevFeatureEnabled(feature: JevFeature): Promise<boolean> {
  try {
    const settings = await getSettings();
    return settings.decisionEngine === "jev" && settings[JEV_FEATURE_SETTING[feature]] === true;
  } catch {
    return false;
  }
}

export async function getJevApiKey(): Promise<string | null> {
  const connections = await getProviderConnections({ provider: JEV_CONNECTION_PROVIDER, isActive: true });
  const key = connections.map((connection) => connection.apiKey).find((value) => typeof value === "string" && value.trim());
  return typeof key === "string" ? key.trim() : null;
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
): Promise<{ [K in keyof Q]: JevAnswer } | null> {
  try {
    const apiKey = await getJevApiKey();
    if (!apiKey) return null;
    const boundedState = typeof state === "string" ? state.slice(0, MAX_STATE_CHARS) : state;
    const response = await fetch(JEV_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: JEV_MODEL, state: boundedState, questions }),
      signal: AbortSignal.timeout(timeoutMs),
    });
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

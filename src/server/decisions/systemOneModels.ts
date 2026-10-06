import "server-only";

// The System One (typed-decision) models the account can use, as the Vercel AI
// Gateway reports them (`GET /typesafe/v1/models`). The list is discovered, not
// embedded: Jev is the only one this repository knows by name, and it is only the
// fallback shown when the gateway cannot be asked.

import { getJevApiKey, JEV_MODEL } from "./jev";

const MODELS_URL = "https://ai-gateway.vercel.sh/typesafe/v1/models";
const MODELS_TIMEOUT_MS = 8_000;
const NAMESPACE = "typesafe-ai/";

export interface SystemOneModel {
  id: string;
  name: string;
  description: string | null;
}

export interface SystemOneModelList {
  models: SystemOneModel[];
  /** "gateway": reported by the AI Gateway. "builtin": only the Jev fallback. */
  source: "gateway" | "builtin";
  /** Why the gateway could not be asked or answered nothing usable. */
  error?: "no_key" | "http" | "network" | "empty";
}

const BUILTIN: SystemOneModel[] = [{
  id: JEV_MODEL,
  name: "Jev",
  description: "TypeSafe AI's probabilistic decision model: typed answers with calibrated probabilities, no generated text.",
}];

function toModel(entry: unknown): SystemOneModel | null {
  const raw = typeof entry === "string" ? { id: entry } : entry;
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const rawId = typeof item.id === "string" ? item.id.trim() : "";
  if (!rawId) return null;
  const id = rawId.includes("/") ? rawId : `${NAMESPACE}${rawId}`;
  const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : id.slice(id.lastIndexOf("/") + 1);
  const description = typeof item.description === "string" && item.description.trim() ? item.description.trim() : null;
  return { id, name, description };
}

/** Tolerates `{ data: [...] }`, `{ models: [...] }` or a bare array of ids/objects. */
export function parseSystemOneModels(payload: unknown): SystemOneModel[] {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? ((payload as Record<string, unknown>).data ?? (payload as Record<string, unknown>).models)
      : null;
  if (!Array.isArray(list)) return [];
  return list.map(toModel).filter((model): model is SystemOneModel => model !== null);
}

export async function listSystemOneModels(): Promise<SystemOneModelList> {
  const apiKey = await getJevApiKey().catch(() => null);
  if (!apiKey) return { models: BUILTIN, source: "builtin", error: "no_key" };
  try {
    const response = await fetch(MODELS_URL, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });
    if (!response.ok) return { models: BUILTIN, source: "builtin", error: "http" };
    const models = parseSystemOneModels(await response.json());
    return models.length ? { models, source: "gateway" } : { models: BUILTIN, source: "builtin", error: "empty" };
  } catch {
    return { models: BUILTIN, source: "builtin", error: "network" };
  }
}

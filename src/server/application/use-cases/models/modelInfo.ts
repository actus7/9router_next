import { getCustomModels } from "@/lib/db/repos/aliasRepo";
import { PROVIDER_ID_TO_ALIAS, PROVIDER_MODELS } from "@/server/llm-gateway/catalog";
import { PROVIDER_MODEL_OVERRIDES } from "@/server/llm-gateway/engine/providers/index";
import { isModelDisabled } from "@/server/llm-gateway/application/modelResolution";
import { AI_PROVIDERS, ALIAS_TO_ID, MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import { getModelKind } from "@/shared/constants/models";
import { ensureProviderCatalog } from "./ensureProviderCatalog";

type ModelRecord = Record<string, unknown>;

// Derived from the catalog so this route cannot advertise a path the dashboard
// contradicts. `llm` is not a media kind, so it is the one entry added here.
const KIND_ENDPOINT: Record<string, string> = {
  llm: "/v1/chat/completions",
  ...Object.fromEntries(MEDIA_PROVIDER_KINDS.map((kind) => [kind.id, kind.endpoint.path])),
};

const TTS_VOICES_API = new Set(["elevenlabs", "edge-tts", "deepgram", "inworld", "local-device"]);

function buildInfo({ alias, providerId, model, kind, providerInfo }: {
  alias: string;
  providerId: string;
  model: ModelRecord;
  kind: string;
  providerInfo?: ModelRecord;
}) {
  const out: ModelRecord = {
    id: `${alias}/${model.id}`,
    name: model.name || model.id,
    kind,
    owned_by: alias,
    endpoint: KIND_ENDPOINT[kind] || null,
  };
  if (model.params) out.params = model.params;
  if (model.capabilities) out.capabilities = model.capabilities;
  if (model.options) out.options = model.options;
  if (model.dimensions) out.dimensions = model.dimensions;
  if (model.contextWindow) out.contextWindow = model.contextWindow;
  if (kind === "tts" && TTS_VOICES_API.has(providerId)) {
    out.voicesUrl = `/v1/audio/voices?provider=${providerId}`;
  }
  if (kind === "webSearch" && providerInfo?.searchConfig) {
    const cfg = providerInfo.searchConfig as ModelRecord;
    if (cfg.searchTypes) out.searchTypes = cfg.searchTypes;
    if (cfg.maxMaxResults) out.maxResults = cfg.maxMaxResults;
    if (cfg.requiredOptions) out.required = cfg.requiredOptions;
  }
  return out;
}

const matchesKind = (model: ModelRecord, requestedKind: string | null) =>
  !requestedKind || getModelKind(model, "llm") === requestedKind;

/**
 * The account's discovered entry for a model, with the registry's
 * `modelOverrides` on top — the same merge `findModel` does for routing.
 *
 * A provider that answers a models endpoint ships no static list (see
 * ARCHITECTURE "O catálogo de modelos é descoberto"), so without this every
 * Kilo/OpenRouter model was a 404 here while `/v1/models` listed it. The
 * discovery is awaited like `/v1/models` does for a provider nobody has asked
 * about yet; `ensureProviderCatalog` is a no-op inside its TTL and never throws.
 */
async function findDiscoveredModel(alias: string, providerId: string, modelId: string, requestedKind: string | null) {
  await ensureProviderCatalog(providerId);
  const aliases = new Set([alias, providerId, PROVIDER_ID_TO_ALIAS[providerId]]);
  const custom = ((await getCustomModels()) as ModelRecord[])
    .find((m) => aliases.has(String(m.providerAlias)) && m.id === modelId && matchesKind(m, requestedKind));
  if (!custom) return null;
  const override = PROVIDER_MODEL_OVERRIDES[alias]?.[modelId] || PROVIDER_MODEL_OVERRIDES[providerId]?.[modelId];
  const merged: ModelRecord = { ...custom, ...override };
  // Discovery stores the provider's own spelling of the context size.
  merged.contextWindow ??= custom.contextLength ?? custom.context_length;
  return merged;
}

// id format: "{alias}/{modelId}" - alias may also be providerId
// requestedKind: optional, disambiguates duplicate ids across kinds (e.g. gemini-2.5-pro llm vs stt)
async function lookup(fullId: string, requestedKind: string | null) {
  if (!fullId || !fullId.includes("/")) return null;
  const slash = fullId.indexOf("/");
  const alias = fullId.slice(0, slash);
  const modelId = fullId.slice(slash + 1);
  const providerId = ALIAS_TO_ID[alias] || alias;
  const providerInfo = AI_PROVIDERS[providerId] as ModelRecord | undefined;

  const list = PROVIDER_MODELS[alias] || PROVIDER_MODELS[providerId] || [];
  const m = list.find((x) => x.id === modelId && matchesKind(x, requestedKind))
    ?? await findDiscoveredModel(alias, providerId, modelId, requestedKind);
  if (m) {
    const kind = getModelKind(m, "llm") || "llm";
    return buildInfo({ alias, providerId, model: m, kind, providerInfo });
  }

  // Web search/fetch — virtual model id "search" / "fetch"
  if (modelId === "search" && providerInfo?.searchConfig) {
    return buildInfo({
      alias, providerId, kind: "webSearch", providerInfo,
      model: { id: "search", name: `${providerInfo.name} Search`, params: ["query", "max_results", "country", "language", "time_range", "domain_filter", "search_type"] },
    });
  }
  if (modelId === "fetch" && providerInfo?.fetchConfig) {
    return buildInfo({
      alias, providerId, kind: "webFetch", providerInfo,
      model: { id: "fetch", name: `${providerInfo.name} Fetch`, params: ["url", "format", "max_characters"] },
    });
  }
  return null;
}

/**
 * Metadata for one model id (`{alias}/{modelId}`), or null when the account
 * cannot use it. Runs inside the caller's tenant scope: the discovered
 * catalogue and the disabled list are per account.
 */
export async function describeModel(fullId: string, requestedKind: string | null): Promise<ModelRecord | null> {
  const info = await lookup(fullId, requestedKind);
  if (!info) return null;
  // A model the operator switched off is not advertised anywhere else, so it
  // must not be described here either.
  const modelId = String(info.id).split("/").slice(1).join("/");
  return (await isModelDisabled(String(info.owned_by), modelId)) ? null : info;
}

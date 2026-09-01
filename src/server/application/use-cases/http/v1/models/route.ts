import { NextRequest } from "next/server";
import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS, getModelKind } from "@/shared/constants/models";
import {
  AI_PROVIDERS,
  getProviderAlias,
  isAnthropicCompatibleProvider,
  isOpenAICompatibleProvider,
} from "@/shared/constants/providers";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo";
import { getCombos } from "@/lib/db/repos/combosRepo";
import { getCustomModels, getModelAliases } from "@/lib/db/repos/aliasRepo";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { resolveKiroModels, resolveKimchiModels, resolveQoderModels, resolveCopilotModels, resolveClinepassModels, resolveGrokCliModels, resolveCursorModels, resolveZedModels, capabilitiesFromServiceKind, getCapabilitiesForModel } from "@/server/llm-gateway/catalog";
import { updateProviderCredentials } from "@/server/llm-gateway/auth";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";

// Per-provider live model resolvers. Each receives a connection record and
// returns { models: [{ id, name? }, ...] } | null on failure.
// Adding a provider here makes /v1/models prefer the live catalog for it.
interface ConnectionRecord {
  id: string;
  accessToken: string;
  refreshToken?: string;
  apiKey?: string;
  email?: string;
  displayName?: string;
  provider?: string;
  providerSpecificData?: Record<string, unknown>;
  isActive?: boolean;
}

const LIVE_MODEL_RESOLVERS: Record<string, (conn: ConnectionRecord) => Promise<{ models: Array<Record<string, unknown>> } | null>> = {
  kiro: async (conn) => {
    const result = await resolveKiroModels({
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken,
      providerSpecificData: conn.providerSpecificData || {}
    } as Parameters<typeof resolveKiroModels>[0], { log: console });
    return result?.models?.length ? { models: result.models as unknown as Array<Record<string, unknown>> } : null;
  },
  qoder: async (conn) => {
    const result = await resolveQoderModels({
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken,
      email: conn.email,
      displayName: conn.displayName,
      providerSpecificData: conn.providerSpecificData || {}
    } as Parameters<typeof resolveQoderModels>[0]);
    if (!result?.models?.length) return null;
    return {
      models: result.models.map((m) => ({ id: (m as Record<string, unknown>).id, name: (m as Record<string, unknown>).name })),
    };
  },
  kimchi: async (conn) => {
    const result = await resolveKimchiModels({
      accessToken: conn.accessToken,
      apiKey: conn.apiKey,
      providerSpecificData: conn.providerSpecificData || {}
    } as Parameters<typeof resolveKimchiModels>[0], { log: console });
    return result?.models?.length ? { models: result.models as unknown as Array<Record<string, unknown>> } : null;
  },
  github: async (conn) => {
    const result = await resolveCopilotModels({
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken,
      providerSpecificData: conn.providerSpecificData || {}
    } as Parameters<typeof resolveCopilotModels>[0], {
      log: console,
      onCredentialsRefreshed: async (refreshed: Record<string, unknown>) => {
        await updateProviderCredentials(conn.id, {
          copilotToken: refreshed.copilotToken as string,
          copilotTokenExpiresAt: refreshed.copilotTokenExpiresAt as number,
          existingProviderSpecificData: conn.providerSpecificData || {},
        });
      },
    });
    return result?.models?.length ? { models: result.models as unknown as Array<Record<string, unknown>> } : null;
  },
  clinepass: async (conn) => {
    const result = await resolveClinepassModels({
      accessToken: conn.accessToken,
      apiKey: conn.apiKey,
    } as Parameters<typeof resolveClinepassModels>[0]);
    return result?.models?.length ? { models: result.models as unknown as Array<Record<string, unknown>> } : null;
  },
  "grok-cli": async (conn) => {
    const proxy = await resolveConnectionProxyConfig(conn.providerSpecificData || {});
    const result = await resolveGrokCliModels({
      ...conn,
      connectionId: conn.id,
    } as Parameters<typeof resolveGrokCliModels>[0], {
      log: console,
      proxyOptions: {
        connectionProxyEnabled: proxy.connectionProxyEnabled === true,
        connectionProxyUrl: proxy.connectionProxyUrl || "",
        connectionNoProxy: proxy.connectionNoProxy || "",
        vercelRelayUrl: proxy.vercelRelayUrl || "",
        strictProxy: proxy.strictProxy === true,
      },
      onCredentialsRefreshed: async (refreshed: Record<string, unknown>) => {
        await updateProviderCredentials(conn.id, {
          ...refreshed,
          existingProviderSpecificData: conn.providerSpecificData || {},
        } as Parameters<typeof updateProviderCredentials>[1]);
      },
    });
    return result?.models?.length ? { models: result.models as unknown as Array<Record<string, unknown>> } : null;
  },
  cursor: async (conn) => {
    const result = await resolveCursorModels({
      accessToken: conn.accessToken,
      providerSpecificData: conn.providerSpecificData || {},
    } as Parameters<typeof resolveCursorModels>[0], { log: console });
    return result?.models?.length ? { models: result.models as unknown as Array<Record<string, unknown>> } : null;
  },
  zed: async (conn) => {
    const result = await resolveZedModels({
      accessToken: conn.accessToken,
      providerSpecificData: conn.providerSpecificData || {},
    } as Parameters<typeof resolveZedModels>[0]);
    if (!result?.models?.length) return null;
    return {
      models: result.models
        .filter((m) => !(m as unknown as Record<string, unknown>).isDisabled)
        .map((m) => {
          const r = m as unknown as Record<string, unknown>;
          return {
            id: r.id,
            name: r.name,
            capabilities: r.supportsTools ? { tools: true } : undefined,
          };
        }),
    };
  },
};

const parseOpenAIStyleModels = (data: unknown) => {
  if (Array.isArray(data)) return data;
  const d = data as Record<string, unknown>;
  return (d?.data || d?.models || d?.results || []) as unknown[];
};

// Header sent by fetchCompatibleModelIds to detect cross-instance /models fetches
// and break recursive loops between modelhub instances connected to each other.
const INTERNAL_MODELS_FETCH_HEADER = "x-9r-internal-models-fetch";

// LLM kind sentinel — combos/models with no explicit kind default to LLM
const LLM_KIND = "llm";

// Map per-model `type` field (in PROVIDER_MODELS) to service kind.
// Models without `type` are treated as LLM.
const MODEL_TYPE_TO_KIND: Record<string, string> = {
  image: "image",
  tts: "tts",
  embedding: "embedding",
  stt: "stt",
  imageToText: "imageToText",
  video: "video",
};

function modelKind(model: Record<string, unknown>) {
  const k = (model?.kind || model?.type) as string | undefined;
  if (!k) return LLM_KIND;
  return MODEL_TYPE_TO_KIND[k] || LLM_KIND;
}

// For dynamic/unknown model IDs (compatible providers, alias map, custom models)
// fall back to provider-level kind matching when per-model type is unavailable.
function inferKindFromUnknownModelId(modelId: string) {
  const lower = String(modelId).toLowerCase();
  if (/embed/.test(lower)) return "embedding";
  if (/tts|speech|audio|voice/.test(lower)) return "tts";
  if (/image|imagen|dall-?e|flux|sdxl|sd-|stable-diffusion/.test(lower)) return "image";
  return LLM_KIND;
}

async function fetchCompatibleModelIds(connection: ConnectionRecord) {
  if (!connection?.apiKey) return [];

  const baseUrl = typeof connection?.providerSpecificData?.baseUrl === "string"
    ? (connection.providerSpecificData.baseUrl as string).trim().replace(/\/$/, "")
    : "";

  if (!baseUrl) return [];

  let url = `${baseUrl}/models`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (connection.provider && isOpenAICompatibleProvider(connection.provider)) {
    headers.Authorization = `Bearer ${connection.apiKey}`;
  } else if (connection.provider && isAnthropicCompatibleProvider(connection.provider)) {
    if (url.endsWith("/messages/models")) {
      url = url.slice(0, -9);
    } else if (url.endsWith("/messages")) {
      url = `${url.slice(0, -9)}/models`;
    }
    headers["x-api-key"] = connection.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers.Authorization = `Bearer ${connection.apiKey}`;
  } else {
    return [];
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, {
      method: "GET",
      headers: { ...headers, [INTERNAL_MODELS_FETCH_HEADER]: "1" },
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) return [];

    const data = await response.json();
    const rawModels = parseOpenAIStyleModels(data);

    return Array.from(
      new Set(
        rawModels
          .map((model) => model?.id || model?.name || model?.model)
          .filter((modelId) => typeof modelId === "string" && modelId.trim() !== "")
      )
    );
  } catch {
    return [];
  }
}

// Provider matches kindFilter when its serviceKinds intersect the requested kinds.
// LLM is the default kind for providers missing serviceKinds.
function providerMatchesKinds(providerId: string, kindFilter: string[]) {
  const provider = AI_PROVIDERS[providerId];
  const kinds = Array.isArray(provider?.serviceKinds) && provider.serviceKinds.length > 0
    ? provider.serviceKinds
    : [LLM_KIND];
  return kindFilter.some((k) => kinds.includes(k));
}

// Combo matches kindFilter when its `kind` field is in the list.
// Combos with no kind are treated as LLM.
function comboMatchesKinds(combo: Record<string, unknown>, kindFilter: string[]) {
  const kind = (combo?.kind || LLM_KIND) as string;
  if (kind === "smart") return true;
  return kindFilter.includes(kind);
}

// ---------------------------------------------------------------------------
// buildModelsList helpers
// ---------------------------------------------------------------------------

interface ModelsData {
  connections: ConnectionRecord[];
  combos: Record<string, unknown>[];
  customModels: Record<string, unknown>[];
  modelAliases: Record<string, unknown>;
  disabledByAlias: Record<string, string[]>;
}

/** Fetch all data sources needed to build the models list. */
async function fetchModelsData(): Promise<ModelsData> {
  let connections: ConnectionRecord[] = [];
  try {
    connections = (await getProviderConnections()) as unknown as ConnectionRecord[];
    connections = connections.filter((c) => c.isActive !== false);
  } catch { console.error("Could not fetch providers, returning all models"); }

  let combos: Record<string, unknown>[] = [];
  try {
    combos = (await getCombos()) as unknown as Record<string, unknown>[];
  } catch { console.error("Could not fetch combos"); }

  let customModels: Record<string, unknown>[] = [];
  try {
    customModels = (await getCustomModels()) as unknown as Record<string, unknown>[];
  } catch { console.error("Could not fetch custom models"); }

  let modelAliases: Record<string, unknown> = {};
  try {
    modelAliases = (await getModelAliases()) as unknown as Record<string, unknown>;
  } catch { console.error("Could not fetch model aliases"); }

  let disabledByAlias: Record<string, string[]> = {};
  try {
    disabledByAlias = (await getDisabledModels()) as unknown as Record<string, string[]>;
  } catch { console.error("Could not fetch disabled models"); }

  return { connections, combos, customModels, modelAliases, disabledByAlias };
}

/** Build combo model entries filtered by kind. */
function buildComboEntries(
  combos: Record<string, unknown>[],
  kindFilter: string[],
): Record<string, unknown>[] {
  const entries: Record<string, unknown>[] = [];
  for (const combo of combos) {
    if (!comboMatchesKinds(combo, kindFilter)) continue;
    const entry: Record<string, unknown> = {
      id: combo.name,
      object: "model",
      owned_by: "combo",
    };
    if (combo.kind === "webSearch" || combo.kind === "webFetch" || combo.kind === "smart") {
      entry.kind = combo.kind;
    }
    entries.push(entry);
  }
  return entries;
}

/** Build static model entries when no DB connections are available. */
function buildStaticModelEntries(
  kindFilter: string[],
  isDisabled: (alias: string, modelId: string) => boolean,
  customModels: Record<string, unknown>[],
): Record<string, unknown>[] {
  const entries: Record<string, unknown>[] = [];
  const aliasToProviderId = Object.fromEntries(
    Object.entries(PROVIDER_ID_TO_ALIAS).map(([id, alias]) => [alias, id])
  );
  for (const [alias, providerModels] of Object.entries(PROVIDER_MODELS)) {
    const providerId = aliasToProviderId[alias] || alias;
    if (!providerMatchesKinds(providerId, kindFilter)) continue;
    for (const model of providerModels as Array<Record<string, unknown>>) {
      if (!kindFilter.includes(modelKind(model))) continue;
      if (isDisabled(alias, model.id as string)) continue;
      entries.push({
        id: `${alias}/${model.id}`,
        object: "model",
        owned_by: alias,
      });
    }
  }

  for (const customModel of customModels) {
    if (!customModel?.id || (customModel.type && customModel.type !== "llm")) continue;
    // Custom models without active connection are LLM-only by current schema
    if (!kindFilter.includes(LLM_KIND)) continue;
    const providerAlias = customModel.providerAlias;
    if (!providerAlias) continue;

    const modelId = String(customModel.id).trim();
    if (!modelId) continue;

    entries.push({
      id: `${providerAlias}/${modelId}`,
      object: "model",
      owned_by: providerAlias,
    });
  }
  return entries;
}

interface ProviderContext {
  providerId: string;
  outputAlias: string;
  staticAlias: string;
  rawModelIds: string[];
  staticModelKindById: Map<string, string>;
  liveModelKindById: Map<string, string>;
  liveCapabilitiesById: Map<string, Record<string, unknown>>;
}

/** Resolve raw model IDs and live/static metadata for a single provider. */
async function resolveProviderContext(
  conn: ConnectionRecord,
  providerId: string,
  kindFilter: string[],
  skipDynamicFetch: boolean,
): Promise<ProviderContext | null> {
  if (!providerMatchesKinds(providerId, kindFilter)) return null;

  const staticAlias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
  const outputAlias = ((
    conn?.providerSpecificData?.prefix
    || getProviderAlias(providerId)
    || staticAlias
  ) as string).trim();
  const providerModels = PROVIDER_MODELS[staticAlias] || [];
  const enabledModels = conn?.providerSpecificData?.enabledModels;
  const hasExplicitEnabledModels =
    Array.isArray(enabledModels) && enabledModels.length > 0;
  const isCompatibleProvider =
    isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);

  // Build kind lookup for static models so we can filter even when only IDs are exposed
  const staticModelKindById = new Map<string, string>(
    providerModels.map((m) => [m.id as string, modelKind(m)])
  );
  let liveModelKindById = new Map<string, string>();
  let liveCapabilitiesById = new Map<string, Record<string, unknown>>();

  let rawModelIds = hasExplicitEnabledModels
    ? Array.from(
        new Set(
          enabledModels.filter(
            (modelId) => typeof modelId === "string" && modelId.trim() !== "",
          ),
        ),
      )
    : providerModels.map((model) => model.id);

  if (isCompatibleProvider && rawModelIds.length === 0 && !skipDynamicFetch) {
    rawModelIds = await fetchCompatibleModelIds(conn);
  }

  // Config-driven live catalog override (e.g. Kiro returns dynamic
  // -thinking/-agentic variants per account). On failure, fall back to
  // whatever rawModelIds already holds.
  const liveResolver = LIVE_MODEL_RESOLVERS[providerId];
  if (liveResolver && !hasExplicitEnabledModels) {
    try {
      const live = await liveResolver(conn);
      if (live?.models?.length) {
        rawModelIds = live.models.map((m) => m.id);
        liveModelKindById = new Map<string, string>(
          live.models
            .filter((m) => m?.id)
            .map((m) => [m.id as string, modelKind(m)])
        );
        liveCapabilitiesById = new Map<string, Record<string, unknown>>(
          live.models
            .filter((m) => m?.id && m.capabilities)
            .map((m) => [m.id as string, m.capabilities as Record<string, unknown>])
        );
      }
    } catch (error) { console.error(`Live model fetch failed for ${providerId}: ${(error instanceof Error ? error.message : String(error))}`); }
  }

  return { providerId, outputAlias, staticAlias, rawModelIds, staticModelKindById, liveModelKindById, liveCapabilitiesById };
}

/** Strip provider prefixes and merge static, custom, and alias model IDs. */
function collectMergedModelIds(
  ctx: ProviderContext,
  customModels: Record<string, unknown>[],
  modelAliases: Record<string, unknown>,
  kindFilter: string[],
): { mergedModelIds: string[]; customModelKindById: Map<string, string> } {
  const { outputAlias, staticAlias, providerId, rawModelIds } = ctx;

  const modelIds = rawModelIds
    .map((modelId) => {
      if (modelId.startsWith(`${outputAlias}/`)) {
        return modelId.slice(outputAlias.length + 1);
      }
      if (modelId.startsWith(`${staticAlias}/`)) {
        return modelId.slice(staticAlias.length + 1);
      }
      if (modelId.startsWith(`${providerId}/`)) {
        return modelId.slice(providerId.length + 1);
      }
      return modelId;
    })
    .filter((modelId) => typeof modelId === "string" && modelId.trim() !== "");

  const customModelKindById = new Map<string, string>();
  const customModelIds = customModels
    .filter((m: Record<string, unknown>) => {
      if (!m?.id) return false;
      const kind = getModelKind(m) || LLM_KIND;
      // imageToText custom models are vision-capable chat models: expose them
      // both in the default LLM list and in /v1/models/image-to-text.
      if (!kindFilter.includes(kind) && !(kind === "imageToText" && kindFilter.includes(LLM_KIND))) return false;
      const alias = m.providerAlias;
      return alias === staticAlias || alias === outputAlias || alias === providerId;
    })
    .map((m) => {
      const modelId = String(m.id).trim();
      if (modelId) customModelKindById.set(modelId, getModelKind(m) || LLM_KIND);
      return modelId;
    })
    .filter((modelId) => modelId !== "");

  const aliasModelIds = (Object.values(modelAliases || {}) as string[])
    .filter((fullModel: string) => {
      if (typeof fullModel !== "string" || !fullModel.includes("/")) return false;
      return (
        fullModel.startsWith(`${outputAlias}/`) ||
        fullModel.startsWith(`${staticAlias}/`) ||
        fullModel.startsWith(`${providerId}/`)
      );
    })
    .map((fullModel: string) => {
      if (fullModel.startsWith(`${outputAlias}/`)) {
        return fullModel.slice(outputAlias.length + 1);
      }
      if (fullModel.startsWith(`${staticAlias}/`)) {
        return fullModel.slice(staticAlias.length + 1);
      }
      if (fullModel.startsWith(`${providerId}/`)) {
        return fullModel.slice(providerId.length + 1);
      }
      return fullModel;
    })
    .filter((modelId) => typeof modelId === "string" && modelId.trim() !== "");

  const mergedModelIds = Array.from(new Set([...modelIds, ...customModelIds, ...aliasModelIds]));
  return { mergedModelIds, customModelKindById };
}

/** Build final model entries (with capabilities) and web search/fetch entries. */
function buildProviderModelEntries(
  ctx: ProviderContext,
  mergedModelIds: string[],
  customModelKindById: Map<string, string>,
  kindFilter: string[],
  isDisabled: (alias: string, modelId: string) => boolean,
): Record<string, unknown>[] {
  const { outputAlias, staticAlias, providerId, staticModelKindById, liveModelKindById, liveCapabilitiesById } = ctx;
  const entries: Record<string, unknown>[] = [];

  for (const modelId of mergedModelIds) {
    // Resolve kind: prefer custom/live metadata, then static, then ID heuristics.
    const customKind = customModelKindById.get(modelId);
    const liveKind = liveModelKindById.get(modelId);
    const kind = customKind || liveKind || staticModelKindById.get(modelId) || inferKindFromUnknownModelId(modelId);
    // imageToText custom models stay in the LLM list (vision-capable chat models)
    const allowAsLlm = kind === "imageToText" && kindFilter.includes(LLM_KIND);
    if (!kindFilter.includes(kind) && !allowAsLlm) continue;
    if (isDisabled(outputAlias, modelId) || isDisabled(staticAlias, modelId)) continue;

    const model: Record<string, unknown> = {
      id: `${outputAlias}/${modelId}`,
      object: "model",
      owned_by: outputAlias,
    };
    // Live-catalog resolvers (kiro/qoder/github/clinepass) mostly only return
    // { id, name } — no per-model capability data. Fall back to the same
    // pattern-matched capabilities the dashboard uses (useModelCaps.js) so
    // dynamically-discovered LLM models still surface vision/reasoning/search/tools.
    const caps: Record<string, unknown> | null = liveCapabilitiesById.get(modelId)
      || capabilitiesFromServiceKind((customKind || liveKind) as string)
      || (kind === LLM_KIND ? getCapabilitiesForModel(providerId, modelId) : null);
    if (caps) model.capabilities = caps;
    // Token limits under the snake_case names the OpenAI/OpenRouter
    // convention uses. `capabilities.contextWindow` is camelCase and nested,
    // so clients matching context_length find nothing, fall back to guessing
    // the window from the model name, and guess high — a 372k model read as
    // 1.05M never reaches its compaction threshold and hard-fails upstream.
    // Emitted at top level because not every client recurses into nested
    // objects; the camelCase `capabilities` block stays for compatibility.
    if (kind === LLM_KIND || allowAsLlm) {
      let contextWindow = caps?.contextWindow as number | undefined;
      let maxOutput = caps?.maxOutput as number | undefined;
      // Live-catalog and service-kind capabilities are usually partial
      // (often just { tools: true }), so fill the gaps from the static
      // table rather than emitting null and leaving clients to guess.
      if (!Number.isFinite(contextWindow) || !Number.isFinite(maxOutput)) {
        const fallback = getCapabilitiesForModel(providerId, modelId);
        if (!Number.isFinite(contextWindow)) contextWindow = fallback.contextWindow;
        if (!Number.isFinite(maxOutput)) maxOutput = fallback.maxOutput;
      }
      if (Number.isFinite(contextWindow)) model.context_length = contextWindow;
      if (Number.isFinite(maxOutput)) model.max_completion_tokens = maxOutput;
    }
    entries.push(model);
  }

  // Web search/fetch — provider IS the model, expose as {alias}/search and/or {alias}/fetch with explicit kind
  const providerInfo = AI_PROVIDERS[providerId];
  if (kindFilter.includes("webSearch") && providerInfo?.searchConfig) {
    entries.push({
      id: `${outputAlias}/search`,
      object: "model",
      kind: "webSearch",
      owned_by: outputAlias,
    });
  }
  if (kindFilter.includes("webFetch") && providerInfo?.fetchConfig) {
    entries.push({
      id: `${outputAlias}/fetch`,
      object: "model",
      kind: "webFetch",
      owned_by: outputAlias,
    });
  }

  return entries;
}

/** Remove duplicate models by id, preserving first occurrence order. */
function deduplicateModels(models: Record<string, unknown>[]): Record<string, unknown>[] {
  const deduped: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    if (!model?.id || seen.has(model.id as string)) continue;
    seen.add(model.id as string);
    deduped.push(model);
  }
  return deduped;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Build OpenAI-format models list filtered by service kinds.
 * @param {string[]} kindFilter - List of service kinds to include (e.g. ["llm"], ["webSearch","webFetch"]).
 */
export async function buildModelsList(kindFilter: string[], options: { skipDynamicFetch?: boolean } = {}) {
  // When this header is present, the /v1/models request came from another
  // modelhub instance's fetchCompatibleModelIds — skip dynamic fetch to break
  // cross-instance recursive loops.
  const skipDynamicFetch = options.skipDynamicFetch === true;
  const data = await fetchModelsData();
  const isDisabled = (alias: string, modelId: string) =>
    Array.isArray(data.disabledByAlias[alias]) && data.disabledByAlias[alias].includes(modelId);

  const activeConnectionByProvider = new Map<string, ConnectionRecord>();
  for (const conn of data.connections) {
    if (conn.provider && !activeConnectionByProvider.has(conn.provider)) {
      activeConnectionByProvider.set(conn.provider, conn);
    }
  }

  const models: Record<string, unknown>[] = [];

  // Combos first (filtered by kind). Web combos expose `kind` so AI knows search vs fetch.
  models.push(...buildComboEntries(data.combos, kindFilter));

  if (data.connections.length === 0) {
    // DB unavailable -> return static models, filtered by per-model kind
    models.push(...buildStaticModelEntries(kindFilter, isDisabled, data.customModels));
  } else {
    for (const [providerId, conn] of activeConnectionByProvider.entries()) {
      const ctx = await resolveProviderContext(conn, providerId, kindFilter, skipDynamicFetch);
      if (!ctx) continue;
      const { mergedModelIds, customModelKindById } = collectMergedModelIds(ctx, data.customModels, data.modelAliases, kindFilter);
      models.push(...buildProviderModelEntries(ctx, mergedModelIds, customModelKindById, kindFilter, isDisabled));
    }
  }

  return deduplicateModels(models);
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/**
 * GET /v1/models - OpenAI compatible models list (LLM/chat models only by default).
 * For other capabilities use /v1/models/{kind} (image, tts, stt, embedding, image-to-text, web).
 */
export async function GET(request: NextRequest) {
  try {
    // Detect cross-instance recursive /models fetch (another modelhub fetching our /models)
    const skipDynamicFetch = request?.headers?.get(INTERNAL_MODELS_FETCH_HEADER) === "1";
    const data = await buildModelsList([LLM_KIND], { skipDynamicFetch });
    return Response.json({ object: "list", data }, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (error: unknown) {
    console.error("Error fetching models:", error);
    return Response.json(
      { error: { message: error instanceof Error ? error.message : String(error), type: "server_error" } },
      { status: 500 }
    );
  }
}
// Application HTTP use case extracted from the Next.js route adapter.

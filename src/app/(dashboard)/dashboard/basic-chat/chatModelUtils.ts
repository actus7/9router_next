import { getModelKind, getModelsByProviderId, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { humanize } from "./chatFormatUtils";
import type { NormalizedModel } from "./types";

/**
 * A provider's catalogue and its `/models` discovery both mix chat models with
 * speech/image/embedding ones (xiaomi-tokenplan returns mimo-v2.5-tts and
 * -asr alongside the chat models). Only chat models belong in the chat picker;
 * the provider screen's toolbar already applies this same rule.
 */
export function isChatKindModel(model: NormalizedModel): boolean {
  const kind = getModelKind(model as unknown as Record<string, unknown>);
  return !kind || kind === "llm";
}

/**
 * The prefixes that mean "this connection's provider" rather than a vendor.
 *
 * A model id carries its vendor — `openrouter/free`, `inclusionai/ling-3.0` —
 * so a slash proves nothing about whether the provider is already named. Only
 * these do.
 */
function providerPrefixes(connection: Record<string, unknown>): string[] {
  const providerId = String(connection.provider || "");
  const nested = connection.providerSpecificData;
  return [
    providerId,
    PROVIDER_ID_TO_ALIAS[providerId] || "",
    String(connection.id || ""),
    typeof nested === "object" && nested ? String((nested as Record<string, unknown>).prefix || "") : "",
  ].filter((prefix) => prefix.length > 0);
}

/**
 * `<provider>/<model>`, the form the gateway reads the provider from.
 *
 * Both normalisers below used to skip the prefix when the raw id contained a
 * slash. For Kilo Gateway that shipped `openrouter/free` as the whole address,
 * and the gateway answered "No active credentials for provider: openrouter".
 */
export function qualifyModelId(rawId: string, connection: Record<string, unknown>): string {
  const providerId = String(connection.provider || "");
  let modelId = rawId.trim();
  for (const prefix of providerPrefixes(connection)) {
    if (modelId.startsWith(`${prefix}/`)) {
      modelId = modelId.slice(prefix.length + 1);
      break;
    }
  }
  return providerId ? `${providerId}/${modelId}` : modelId;
}

export function getProviderLabel(connection: Record<string, unknown>): string {
  return (connection?.name as string) || humanize((connection?.provider as string) || (connection?.id as string) || "provider");
}

/**
 * Catálogo embarcado de um provider, indexado por id.
 *
 * `normalizeConfiguredModel` é chamado por modelo e varria a lista inteira em
 * cada chamada. `PROVIDER_MODELS` é imutável em runtime — o catálogo descoberto
 * vai para o banco, não para esse objeto —, então o índice vale pelo processo.
 */
const CATALOG_BY_PROVIDER = new Map<string, Map<string, Record<string, unknown>>>();

function catalogIndex(providerId: string): Map<string, Record<string, unknown>> {
  let index = CATALOG_BY_PROVIDER.get(providerId);
  if (!index) {
    index = new Map(getModelsByProviderId(providerId).map((model) => [String(model.id), model]));
    CATALOG_BY_PROVIDER.set(providerId, index);
  }
  return index;
}

export function normalizeConfiguredModel(rawModel: string, connection: Record<string, unknown>): NormalizedModel | null {
  const providerId = connection.provider as string;
  const rawId = rawModel.trim();
  if (!providerId || !rawId) return null;
  const requestModel = qualifyModelId(rawId, connection);
  const modelId = requestModel.slice(providerId.length + 1);
  const catalogModel = catalogIndex(providerId).get(modelId);
  return {
    id: requestModel,
    requestModel,
    name: typeof catalogModel?.name === "string" ? catalogModel.name : modelId,
    providerId,
    providerName: getProviderLabel(connection),
    source: "configured",
  };
}

function configuredModelIds(connection: Record<string, unknown>): string[] {
  const nested = connection.providerSpecificData;
  const values: unknown[] = [
    connection.defaultModel,
    connection.model,
    connection.enabledModels,
    connection.models,
    typeof nested === "object" && nested ? (nested as Record<string, unknown>).defaultModel : undefined,
    typeof nested === "object" && nested ? (nested as Record<string, unknown>).model : undefined,
    typeof nested === "object" && nested ? (nested as Record<string, unknown>).enabledModels : undefined,
    typeof nested === "object" && nested ? (nested as Record<string, unknown>).models : undefined,
  ];

  return Array.from(new Set(values.flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim())));
}

export function isConnectionSelectable(connection: Record<string, unknown>): boolean {
  if (connection.isActive !== true) return false;
  const status = typeof connection.testStatus === "string" ? connection.testStatus.toLowerCase() : "";
  return !["error", "expired", "unavailable", "inactive", "disabled"].includes(status);
}

export function normalizeLiveModel(model: string | Record<string, unknown>, connection: Record<string, unknown>): NormalizedModel | null {
  const rawId = typeof model === "string" ? model : (model?.id as string) || (model?.name as string) || (model?.model as string) || "";
  if (!rawId) return null;

  // Google's Generative Language API returns `name` as the resource path
  // (e.g. "models/gemini-2.5-flash") and `displayName` as the human-readable
  // label ("Gemini 2.5 Flash") — prefer displayName, and strip a leading
  // "models/" from whatever's left so unlabeled providers don't show it raw.
  const displayName = typeof model === "string"
    ? model.replace(/^models\//, "")
    : (model?.displayName as string) || ((model?.name as string) || rawId).replace(/^models\//, "");

  const requestModel = qualifyModelId(rawId, connection);

  return {
    id: requestModel,
    requestModel,
    name: displayName,
    providerId: connection.provider as string,
    providerName: getProviderLabel(connection),
    source: "live",
    ...(typeof model === "object" && model && typeof model.capabilities === "object" && model.capabilities
      ? { caps: model.capabilities as Record<string, boolean> }
      : {}),
    ...(typeof model === "object" && model && typeof model.type === "string" ? { kind: model.type } : {}),
  };
}

// `enabledModels` is the provider connection's allow-list.  It is deliberately
// kept separate from `configuredModelIds`: a default model is useful metadata,
// but must not turn a provider's complete remote catalogue into selectable
// chat models.  Kiro, for example, can return many account-visible variants
// while only a small subset is enabled in its connection settings.
function explicitEnabledModelIds(connection: Record<string, unknown>): string[] {
  const nested = connection.providerSpecificData;
  const values = [
    connection.enabledModels,
    typeof nested === "object" && nested ? (nested as Record<string, unknown>).enabledModels : undefined,
  ];

  return Array.from(new Set(values.flatMap((value) => Array.isArray(value) ? value : [])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim())));
}

export function selectableConfiguredModelIds(connection: Record<string, unknown>): string[] {
  const enabledModels = explicitEnabledModelIds(connection);
  return enabledModels.length > 0 ? enabledModels : configuredModelIds(connection);
}

function modelIdentity(rawModelId: string, connection: Record<string, unknown>): string {
  let modelId = rawModelId.trim().replace(/^models\//, "");
  const nested = connection.providerSpecificData;
  const prefixes = [
    connection.provider,
    PROVIDER_ID_TO_ALIAS[String(connection.provider || "")],
    connection.id,
    typeof nested === "object" && nested ? (nested as Record<string, unknown>).prefix : undefined,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  for (const prefix of prefixes) {
    if (modelId.startsWith(`${prefix}/`)) {
      modelId = modelId.slice(prefix.length + 1);
      break;
    }
  }

  return modelId.toLowerCase();
}

/**
 * Identidades permitidas de uma conexão, resolvidas uma vez por objeto.
 *
 * Os três predicados abaixo rodam por modelo sobre a resposta de
 * `/api/providers/{id}/models` — um catálogo descoberto passa de 300 entradas —
 * e cada um varria a lista inteira chamando `modelIdentity` em cada item. Isso
 * é O(n²) sobre uma função que faz trim, replace e varredura de prefixos. O
 * `WeakMap` chaveia pelo próprio objeto da conexão, então nada precisa ser
 * invalidado: uma conexão recarregada é um objeto novo.
 */
type ConnectionIndex = { enabled: Set<string> | null; allowed: Set<string> | null };
const CONNECTION_INDEX = new WeakMap<object, ConnectionIndex>();

function connectionIndex(connection: Record<string, unknown>): ConnectionIndex {
  const cached = CONNECTION_INDEX.get(connection);
  if (cached) return cached;

  const enabledIds = explicitEnabledModelIds(connection);
  const configuredIds = selectableConfiguredModelIds(connection);
  // Providers without a curated catalogue are explicitly dynamic; their live
  // response is the only configuration source available.
  const allowedIds = configuredIds.length > 0
    ? configuredIds
    : getModelsByProviderId(String(connection.provider || connection.id || ""))
      .map((catalogModel) => String(catalogModel.id || ""));

  const index: ConnectionIndex = {
    enabled: enabledIds.length === 0 ? null : new Set(enabledIds.map((id) => modelIdentity(id, connection))),
    allowed: allowedIds.length === 0 ? null : new Set(allowedIds.map((id) => modelIdentity(id, connection))),
  };
  CONNECTION_INDEX.set(connection, index);
  return index;
}

export function isExplicitlyEnabledModel(model: NormalizedModel, connection: Record<string, unknown>): boolean {
  const { enabled } = connectionIndex(connection);
  if (enabled === null) return true;
  return enabled.has(modelIdentity(model.requestModel, connection));
}

// Discovery answers "what this account can see", not "what an administrator
// enabled in this router". Keep live metadata (name/capabilities), but only
// expose IDs already configured for the connection; when a connection has no
// explicit list, the provider's curated catalogue is the configuration.
export function isConfiguredChatModel(model: NormalizedModel, connection: Record<string, unknown>): boolean {
  const { allowed } = connectionIndex(connection);
  if (allowed === null) return true;
  return allowed.has(modelIdentity(model.requestModel, connection));
}

/**
 * Identidades desabilitadas de uma conexão. `null` quer dizer "catálogo
 * limpo" — nenhum modelo passa.
 *
 * Mesmo motivo do `connectionIndex`: sem isto a lista de desabilitados era
 * remapeada por modelo, e ela cresce sozinha (o "Test All" desabilita todo
 * modelo definitivamente indisponível). Chaveado pelo objeto
 * `disabledByProvider`, que é estável dentro de um mesmo carregamento.
 */
const DISABLED_INDEX = new WeakMap<object, WeakMap<object, { keys: Set<string> | null }>>();

function disabledIndex(
  disabledByProvider: Record<string, string[]>,
  connection: Record<string, unknown>,
  aliases: Set<string>,
): Set<string> | null {
  let byConnection = DISABLED_INDEX.get(disabledByProvider);
  if (!byConnection) {
    byConnection = new WeakMap();
    DISABLED_INDEX.set(disabledByProvider, byConnection);
  }
  // Chaveado pelo objeto da conexão, não pelos aliases: `modelIdentity` corta os
  // prefixos *dela*, então duas conexões do mesmo provider podem produzir
  // identidades diferentes para a mesma lista de ids.
  const cached = byConnection.get(connection);
  if (cached) return cached.keys;

  const disabledIds = Array.from(aliases).flatMap((alias) => disabledByProvider[alias] || []);
  const keys = disabledIds.includes("__catalog_cleared__")
    ? null
    : new Set(disabledIds.map((disabledId) => modelIdentity(disabledId, connection)));
  byConnection.set(connection, { keys });
  return keys;
}

export function isModelEnabledForChat(
  model: NormalizedModel,
  connection: Record<string, unknown>,
  disabledByProvider: Record<string, string[]>,
): boolean {
  const providerId = String(connection.provider || connection.id || "");
  const aliases = new Set([providerId, PROVIDER_ID_TO_ALIAS[providerId] || providerId]);
  const disabled = disabledIndex(disabledByProvider, connection, aliases);
  if (disabled === null) return false;
  return !disabled.has(modelIdentity(model.requestModel, connection));
}

// Fallback for a provider whose connection has no per-connection configured
// models and whose live /models fetch failed or isn't supported (not every
// provider is wired into PROVIDER_MODELS_CONFIG) — without this, such a
// provider silently ends up with zero models and is dropped from the picker
// entirely, even though it's an active, working connection.
export function normalizeStaticModel(model: Record<string, unknown>, connection: Record<string, unknown>): NormalizedModel | null {
  const modelId = model?.id as string;
  if (!modelId) return null;
  const providerId = connection.provider as string;
  const requestModel = qualifyModelId(modelId, connection);
  return {
    id: requestModel,
    requestModel,
    name: (model.name as string) || modelId,
    providerId,
    providerName: getProviderLabel(connection),
    source: "static",
  };
}

export function parseProviderModelsPayload(data: Record<string, unknown>): unknown[] {
  if (Array.isArray(data?.models)) return data.models;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data)) return data;
  return [];
}

export function dedupeModels(models: NormalizedModel[]): NormalizedModel[] {
  const map = new Map<string, NormalizedModel>();
  for (const model of models) {
    if (!model?.id) continue;
    if (!map.has(model.id)) map.set(model.id, model);
  }
  return Array.from(map.values());
}

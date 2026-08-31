import { getModelsByProviderId, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { humanize } from "./chatFormatUtils";
import type { NormalizedModel } from "./types";

export function getProviderLabel(connection: Record<string, unknown>): string {
  return (connection?.name as string) || humanize((connection?.provider as string) || (connection?.id as string) || "provider");
}

export function normalizeConfiguredModel(rawModel: string, connection: Record<string, unknown>): NormalizedModel | null {
  const providerId = connection.provider as string;
  const rawId = rawModel.trim();
  if (!providerId || !rawId) return null;
  const modelId = rawId.startsWith(`${providerId}/`) ? rawId.slice(providerId.length + 1) : rawId;
  const catalogModel = getModelsByProviderId(providerId).find((model) => model.id === modelId);
  const requestModel = rawId.includes("/") ? rawId : `${providerId}/${rawId}`;
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

  const requestModel = rawId.includes("/") ? rawId : `${connection.provider}/${rawId}`;

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

export function isExplicitlyEnabledModel(model: NormalizedModel, connection: Record<string, unknown>): boolean {
  const enabledModels = explicitEnabledModelIds(connection);
  if (enabledModels.length === 0) return true;
  const modelKey = modelIdentity(model.requestModel, connection);
  return enabledModels.some((enabledModel) => modelIdentity(enabledModel, connection) === modelKey);
}

// Discovery answers "what this account can see", not "what an administrator
// enabled in this router". Keep live metadata (name/capabilities), but only
// expose IDs already configured for the connection; when a connection has no
// explicit list, the provider's curated catalogue is the configuration.
export function isConfiguredChatModel(model: NormalizedModel, connection: Record<string, unknown>): boolean {
  const configuredIds = selectableConfiguredModelIds(connection);
  const allowedIds = configuredIds.length > 0
    ? configuredIds
    : getModelsByProviderId(String(connection.provider || connection.id || ""))
      .map((catalogModel) => String(catalogModel.id || ""));

  // Providers without a curated catalogue are explicitly dynamic; their live
  // response is the only configuration source available.
  if (allowedIds.length === 0) return true;
  const modelKey = modelIdentity(model.requestModel, connection);
  return allowedIds.some((allowedId) => modelIdentity(allowedId, connection) === modelKey);
}

export function isModelEnabledForChat(
  model: NormalizedModel,
  connection: Record<string, unknown>,
  disabledByProvider: Record<string, string[]>,
): boolean {
  const providerId = String(connection.provider || connection.id || "");
  const aliases = new Set([providerId, PROVIDER_ID_TO_ALIAS[providerId] || providerId]);
  const disabledIds = Array.from(aliases).flatMap((alias) => disabledByProvider[alias] || []);
  if (disabledIds.includes("__catalog_cleared__")) return false;
  const modelKey = modelIdentity(model.requestModel, connection);
  return !disabledIds.some((disabledId) => modelIdentity(disabledId, connection) === modelKey);
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
  const requestModel = `${providerId}/${modelId}`;
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

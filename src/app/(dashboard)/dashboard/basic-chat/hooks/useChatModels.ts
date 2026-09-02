"use client";

import { useEffect, useMemo, useState } from "react";
import { translate } from "@/i18n/runtime";
import { getProviderAlias, isAnthropicCompatibleProvider, isOpenAICompatibleProvider } from "@/shared/constants/providers";
import { getStoredModelTestLatencies, sortModelsByTestLatency } from "@/shared/utils/modelTestLatency";
import { textValue } from "../chatFormatUtils";
import {
  dedupeModels, getProviderLabel, isConfiguredChatModel, isConnectionSelectable,
  isExplicitlyEnabledModel, isModelEnabledForChat, normalizeConfiguredModel, normalizeLiveModel,
  normalizeStaticModel, parseProviderModelsPayload, selectableConfiguredModelIds,
} from "../chatModelUtils";
import type { NormalizedModel, ProviderGroup } from "../types";

interface FreeModelGroupPayload {
  providerId: string;
  providerName: string;
  models: Array<{ id: string; name: string }>;
}

const FREE_MODELS_CLIENT_TIMEOUT_MS = 3_000;

export function isFreeModelEnabledForChat(
  providerId: string,
  modelId: string,
  disabledByProvider: Record<string, string[]>,
): boolean {
  const aliases = new Set([providerId, getProviderAlias(providerId)].filter(Boolean));
  const disabledIds = Array.from(aliases).flatMap((alias) => disabledByProvider[alias] || []);
  if (disabledIds.includes("__catalog_cleared__")) return false;
  const normalized = modelId.toLowerCase().replace(/^.+?\//, "");
  return !disabledIds.some((id) => id.toLowerCase().replace(/^.+?\//, "") === normalized);
}

export function buildFreeChatModels(
  providerId: string,
  catalogModels: Array<{ id: string; name: string }>,
  customModels: Array<Record<string, unknown>>,
  disabledByProvider: Record<string, string[]>,
): Array<{ id: string; name: string }> {
  const alias = getProviderAlias(providerId);
  const providerAliases = new Set([providerId, alias]);
  const merged = new Map<string, { id: string; name: string }>();
  const add = (model: { id: string; name: string }) => {
    if (!model.id || !isFreeModelEnabledForChat(providerId, model.id, disabledByProvider)) return;
    const key = model.id.toLowerCase();
    if (!merged.has(key)) merged.set(key, model);
  };

  catalogModels.forEach(add);
  customModels
    .filter((entry) => (entry.kind || entry.type || "llm") === "llm")
    .filter((entry) => providerAliases.has(String(entry.providerAlias || "")))
    .forEach((entry) => {
      const rawId = String(entry.id || "").trim();
      if (!rawId) return;
      add({
        id: rawId.startsWith(`${alias}/`) ? rawId : `${alias}/${rawId}`,
        name: String(entry.name || rawId),
      });
    });

  return Array.from(merged.values());
}

function toFreeProviderGroups(
  groups: FreeModelGroupPayload[],
  customModels: Array<Record<string, unknown>>,
  disabledByProvider: Record<string, string[]>,
  testLatencies: ReturnType<typeof getStoredModelTestLatencies>,
): ProviderGroup[] {
  return groups.map((group) => ({
    providerId: group.providerId,
    providerName: group.providerName,
    providerType: "free",
    connections: [],
    models: sortModelsByTestLatency(dedupeModels(
      buildFreeChatModels(group.providerId, group.models || [], customModels, disabledByProvider)
        .map((model) => ({
          id: model.id,
          requestModel: model.id,
          name: model.name,
          providerId: group.providerId,
          providerName: group.providerName,
          source: "catalog" as const,
        })),
    ), testLatencies),
  })).filter((group) => group.models.length > 0)
    .sort((a, b) => a.providerName.localeCompare(b.providerName));
}

export interface UseChatModelsReturn {
  providerGroups: ProviderGroup[];
  loadingData: boolean;
  providerLoadError: string;
  modelIndex: Map<string, NormalizedModel>;
}

// Owns discovery and normalization of the chat-eligible model catalogue:
// fetches active provider connections, per-connection configured models,
// live /models discovery, then merges and dedupes only models that are
// actually enabled for an active connection into `providerGroups`.
export function useChatModels(): UseChatModelsReturn {
  const [providerGroups, setProviderGroups] = useState<ProviderGroup[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [providerLoadError, setProviderLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoadingData(true);
      setProviderLoadError("");
      const testLatencies = getStoredModelTestLatencies();

      try {
        // Free catalogues are optional metadata. Start their request now, but
        // never make existing configured connections wait for it to resolve.
        const freeModelsPromise = fetch("/api/models/free", {
          cache: "no-store",
          signal: AbortSignal.timeout(FREE_MODELS_CLIENT_TIMEOUT_MS),
        }).catch(() => null);
        const [providersRes, disabledModelsRes, customModelsRes] = await Promise.all([
          fetch("/api/providers", { cache: "no-store" }),
          fetch("/api/models/disabled", { cache: "no-store" }),
          fetch("/api/models/custom", { cache: "no-store" }),
        ]);
        const providersData = await providersRes.json().catch(() => ({})) as Record<string, unknown>;
        const disabledModelsData = await disabledModelsRes.json().catch(() => ({})) as Record<string, unknown>;
        const customModelsData = await customModelsRes.json().catch(() => ({})) as Record<string, unknown>;
        const disabledByProvider = disabledModelsRes.ok && typeof disabledModelsData.disabled === "object" && disabledModelsData.disabled
          ? disabledModelsData.disabled as Record<string, string[]>
          : {};
        const customModels = customModelsRes.ok && Array.isArray(customModelsData.models)
          ? customModelsData.models as Array<Record<string, unknown>>
          : [];
        const connections = Array.isArray(providersData.connections)
          ? (providersData.connections as Array<Record<string, unknown>>).filter(isConnectionSelectable)
          : [];

        if (connections.length === 0) {
          const freeModelsRes = await freeModelsPromise;
          if (!cancelled) {
            const freeModelsData = freeModelsRes ? await freeModelsRes.json().catch(() => ({})) as { groups?: FreeModelGroupPayload[] } : {};
            const freeProviderGroups = freeModelsRes?.ok && Array.isArray(freeModelsData.groups)
              ? toFreeProviderGroups(freeModelsData.groups, customModels, disabledByProvider, testLatencies)
              : [];
            setProviderGroups(freeProviderGroups);
            if (freeProviderGroups.length === 0) {
              setProviderLoadError(translate("No active, configured providers available yet.") || "No active, configured providers available yet.");
            }
          }
          return;
        }

        const providerMap = new Map<string, ProviderGroup>();

        for (const connection of connections) {
          const providerId = (connection.provider as string) || (connection.id as string);
          const providerName = getProviderLabel(connection);
          const providerType = isOpenAICompatibleProvider(providerId)
            ? "openai-compatible"
            : isAnthropicCompatibleProvider(providerId)
              ? "anthropic-compatible"
              : providerId;

          let group = providerMap.get(providerId);
          if (!group) {
            group = {
              providerId,
              providerName,
              providerType,
              connections: [],
              models: [],
            };
            providerMap.set(providerId, group);
          }

          group.providerName = group.providerName || providerName;
          group.providerType = group.providerType || providerType;
          group.connections.push(connection);

          // A catalogue is metadata, not proof that a model can be requested.
          // Only an explicitly configured model or a provider's successful live
          // discovery response is allowed into the picker.
          group.models.push(...selectableConfiguredModelIds(connection)
            .map((modelId) => normalizeConfiguredModel(modelId, connection))
            .filter((model): model is NormalizedModel => model !== null)
            .filter((model) => isModelEnabledForChat(model, connection, disabledByProvider)));

          // Models added by Refresh Models or manually in the provider screen
          // are an explicit local configuration. They must be available to the
          // chat even when the connection's remote `enabledModels` field is
          // stale or absent; disabled entries remain excluded below.
          const providerAliases = new Set([
            providerId,
            String(connection.provider || ""),
            getProviderAlias(providerId),
            String(connection.alias || ""),
          ].filter(Boolean));
          group.models.push(...customModels
            .filter((entry) => (entry.kind || entry.type || "llm") === "llm")
            .filter((entry) => providerAliases.has(String(entry.providerAlias || "")))
            .map((entry) => normalizeConfiguredModel(String(entry.id || ""), connection))
            .filter((model): model is NormalizedModel => model !== null)
            .filter((model) => isModelEnabledForChat(model, connection, disabledByProvider)));
        }

        const liveResults = await Promise.all(
          connections.map(async (connection: Record<string, unknown>) => {
            try {
              const response = await fetch(`/api/providers/${connection.id}/models`, { cache: "no-store" });
              const data = await response.json().catch(() => ({})) as Record<string, unknown>;
              if (!response.ok) return { connection, models: [] };
              const models = parseProviderModelsPayload(data)
                .map((model: unknown) => normalizeLiveModel(model as string | Record<string, unknown>, connection))
                .filter((model): model is NormalizedModel => model !== null)
                .filter((model) => isExplicitlyEnabledModel(model, connection))
                .filter((model) => isConfiguredChatModel(model, connection))
                .filter((model) => isModelEnabledForChat(model, connection, disabledByProvider));
              return { connection, models };
            } catch {
              return { connection, models: [] };
            }
          })
        );

        for (const result of liveResults) {
          const providerId = String(result.connection.provider || result.connection.id || "");
          const group = providerMap.get(providerId);
          if (!group) continue;
          group.models.push(...result.models);
        }

        // Fallback for providers that ended up with zero models (no curated
        // catalog entry, no explicit configuration, and live discovery
        // failed): use the connection's own defaultModel so the provider
        // isn't silently dropped from the picker despite being active.
        for (const group of providerMap.values()) {
          if (group.models.length > 0) continue;
          for (const connection of group.connections) {
            const nested = connection.providerSpecificData;
            const defaultModelId = (connection.defaultModel as string)
              || (typeof nested === "object" && nested ? (nested as Record<string, unknown>).defaultModel as string : undefined);
            if (!defaultModelId) continue;
            const fallbackModel = normalizeStaticModel({ id: defaultModelId }, connection);
            if (fallbackModel && isModelEnabledForChat(fallbackModel, connection, disabledByProvider)) {
              group.models.push(fallbackModel);
              break;
            }
          }
        }

        const configuredGroups = Array.from(providerMap.values())
          .map((group) => ({
            ...group,
            models: sortModelsByTestLatency(dedupeModels(group.models), testLatencies),
          }))
          .filter((group) => group.models.length > 0)
          .sort((a, b) => a.providerName.localeCompare(b.providerName));

        if (!cancelled) {
          setProviderGroups(configuredGroups);
          setLoadingData(false);
        }

        const freeModelsRes = await freeModelsPromise;
        const freeModelsData = freeModelsRes ? await freeModelsRes.json().catch(() => ({})) as { groups?: FreeModelGroupPayload[] } : {};
        const freeProviderGroups = freeModelsRes?.ok && Array.isArray(freeModelsData.groups)
          ? toFreeProviderGroups(freeModelsData.groups, customModels, disabledByProvider, testLatencies)
          : [];
        const normalized = [...freeProviderGroups, ...configuredGroups]
          .sort((a, b) => a.providerName.localeCompare(b.providerName));

        if (!cancelled) {
          setProviderGroups(normalized);
          if (normalized.length === 0) {
            setProviderLoadError(translate("Active providers have no configured or available chat models.") || "Active providers have no configured or available chat models.");
          }
        }
      } catch (error) {
        if (!cancelled) {
          setProviderLoadError(textValue((error as Record<string, unknown>)?.message) || (translate("Failed to load providers/models.") || "Failed to load providers/models."));
          setProviderGroups([]);
        }
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, []);

  const modelIndex = useMemo(() => {
    const map = new Map<string, NormalizedModel>();
    for (const group of providerGroups) {
      for (const model of group.models) {
        map.set(model.id, {
          ...model,
          providerId: group.providerId,
          providerName: group.providerName,
        });
      }
    }
    return map;
  }, [providerGroups]);

  return { providerGroups, loadingData, providerLoadError, modelIndex };
}

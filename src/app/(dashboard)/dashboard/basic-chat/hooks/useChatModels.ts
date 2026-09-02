"use client";

import { useEffect, useMemo, useState } from "react";
import { translate } from "@/i18n/runtime";
import { getProviderAlias, isAnthropicCompatibleProvider, isOpenAICompatibleProvider } from "@/shared/constants/providers";
import { textValue } from "../chatFormatUtils";
import {
  dedupeModels, getProviderLabel, isConfiguredChatModel, isConnectionSelectable,
  isExplicitlyEnabledModel, isModelEnabledForChat, normalizeConfiguredModel, normalizeLiveModel,
  parseProviderModelsPayload, selectableConfiguredModelIds,
} from "../chatModelUtils";
import type { NormalizedModel, ProviderGroup } from "../types";

interface FreeModelGroupPayload {
  providerId: string;
  providerName: string;
  models: Array<{ id: string; name: string }>;
}

export interface UseChatModelsReturn {
  providerGroups: ProviderGroup[];
  loadingData: boolean;
  providerLoadError: string;
  modelIndex: Map<string, NormalizedModel>;
  blockedModelIds: Set<string>;
  setBlockedModelIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}

// Owns discovery and normalization of the chat-eligible model catalogue:
// fetches active provider connections, per-connection configured models,
// live /models discovery, then merges and dedupes only models that are
// actually enabled for an active connection into `providerGroups`.
export function useChatModels(): UseChatModelsReturn {
  const [providerGroups, setProviderGroups] = useState<ProviderGroup[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [providerLoadError, setProviderLoadError] = useState("");
  const [blockedModelIds, setBlockedModelIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoadingData(true);
      setProviderLoadError("");

      try {
        const [providersRes, disabledModelsRes, customModelsRes, freeModelsRes] = await Promise.all([
          fetch("/api/providers", { cache: "no-store" }),
          fetch("/api/models/disabled", { cache: "no-store" }),
          fetch("/api/models/custom", { cache: "no-store" }),
          fetch("/api/models/free", { cache: "no-store" }),
        ]);
        const providersData = await providersRes.json().catch(() => ({})) as Record<string, unknown>;
        const disabledModelsData = await disabledModelsRes.json().catch(() => ({})) as Record<string, unknown>;
        const customModelsData = await customModelsRes.json().catch(() => ({})) as Record<string, unknown>;
        const freeModelsData = await freeModelsRes.json().catch(() => ({})) as { groups?: FreeModelGroupPayload[] };
        const freeProviderGroups: ProviderGroup[] = freeModelsRes.ok && Array.isArray(freeModelsData.groups)
          ? freeModelsData.groups.map((g) => ({
              providerId: g.providerId,
              providerName: g.providerName,
              providerType: "free",
              connections: [],
              models: (g.models || []).map((m) => ({
                id: m.id,
                requestModel: m.id,
                name: m.name,
                providerId: g.providerId,
                providerName: g.providerName,
                source: "catalog" as const,
              })),
            }))
          : [];
        const disabledByProvider = disabledModelsRes.ok && typeof disabledModelsData.disabled === "object" && disabledModelsData.disabled
          ? disabledModelsData.disabled as Record<string, string[]>
          : {};
        const customModels = customModelsRes.ok && Array.isArray(customModelsData.models)
          ? customModelsData.models as Array<Record<string, unknown>>
          : [];
        const connections = Array.isArray(providersData.connections)
          ? (providersData.connections as Array<Record<string, unknown>>).filter(isConnectionSelectable)
          : [];

        if (connections.length === 0 && freeProviderGroups.length === 0) {
          if (!cancelled) {
            setProviderGroups([]);
            setProviderLoadError(translate("No active, configured providers available yet.") || "No active, configured providers available yet.");
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

        const normalized = [...freeProviderGroups, ...Array.from(providerMap.values())]
          .map((group) => ({
            ...group,
            models: dedupeModels(group.models).sort((a, b) => a.name.localeCompare(b.name)),
          }))
          .map((group) => ({ ...group, models: group.models.filter((model: NormalizedModel) => !blockedModelIds.has(model.id)) }))
          .filter((group) => group.models.length > 0)
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
  }, [blockedModelIds]);

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

  return { providerGroups, loadingData, providerLoadError, modelIndex, blockedModelIds, setBlockedModelIds };
}

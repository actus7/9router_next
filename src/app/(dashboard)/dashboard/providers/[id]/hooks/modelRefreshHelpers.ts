"use client";

import { getModelKind, getModelsByProviderId } from "@/shared/constants/models";
import { translate } from "@/i18n/runtime";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { fetchSuggestedModels, type ModelsFetcher } from "@/shared/utils/providerModelsFetcher";
import { CLEAR_ALL_MODELS_SENTINEL } from "./modelConstants";
import type { Connection, CustomModelEntry, LiveModel, ProviderNode, SuggestedModel } from "../types";

interface RefreshModelsArgs {
  providerId: string;
  providerStorageAlias: string;
  isCompatible: boolean;
  connections: Connection[];
  providerNode: ProviderNode | null;
  customModels: CustomModelEntry[];
  modelAliases: Record<string, string>;
  setLiveModels: React.Dispatch<React.SetStateAction<LiveModel[]>>;
  setCustomModels: React.Dispatch<React.SetStateAction<CustomModelEntry[]>>;
  setModelAliases: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onFetchDisabledModels: () => Promise<void>;
  notify: { error: (msg: string) => void; warning: (msg: string) => void; success: (msg: string) => void };
}

export async function refreshModels({
  providerId, providerStorageAlias, isCompatible, connections, providerNode,
  customModels, modelAliases, setLiveModels, setCustomModels, setModelAliases,
  onFetchDisabledModels, notify,
}: RefreshModelsArgs): Promise<void> {
  const activeConnection = connections.find((conn) => conn.isActive !== false);
  let fetched: Array<{ id?: string; name?: string; kind?: string; type?: string }> = [];

  if (activeConnection) {
    const res = await fetch(`/api/providers/${activeConnection.id}/models`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) { notify.error(data.error || translate("Failed to fetch models")); return; }
    fetched = data.models || [];
  } else if (isCompatible && providerNode?.baseUrl) {
    const baseUrl = (providerNode.baseUrl as string).replace(/\/$/, "");
    const res = await fetch(`${baseUrl}/models`, { cache: "no-store" });
    if (!res.ok) { notify.error(translate("Failed to fetch models") + ` (${res.status})`); return; }
    const data = await res.json();
    fetched = data.data || data.models || [];
  } else {
    const fetcher = AI_PROVIDERS[providerId]?.modelsFetcher as { url: string; type: string } | undefined;
    if (fetcher) { fetched = await fetchSuggestedModels(fetcher); }
    else {
      fetched = getModelsByProviderId(providerId);
      if (fetched.length === 0) { notify.error(translate("No active connection available") || ""); return; }
    }
  }

  if (fetched.length === 0) { notify.warning(translate("No models returned") || ""); return; }

  const fetchedIds = new Set(fetched.map((m) => m.id || m.name).filter((id): id is string => typeof id === "string" && id.length > 0));
  const fetchedLlmModels = fetched.filter((m) => !!(m.id || m.name) && (getModelKind(m) || "llm") === "llm");
  const restoredIds = [...fetchedIds, CLEAR_ALL_MODELS_SENTINEL];
  if (restoredIds.length > 0) {
    const restoreResponse = await fetch("/api/models/disabled", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerAlias: providerStorageAlias, ids: restoredIds, action: "enable" }) });
    if (restoreResponse.ok) await onFetchDisabledModels();
  }

  const syncResponse = await fetch("/api/models/discovered", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerAlias: providerStorageAlias, models: fetchedLlmModels }) });
  const syncData = await syncResponse.json();
  if (!syncResponse.ok) { notify.error(syncData.error || "Failed to synchronize models"); return; }
  if (Array.isArray(syncData.models)) setCustomModels(syncData.models);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("customModelChanged"));
  setLiveModels(fetched as LiveModel[]);
  notify.success(`Atualizado: ${fetched.length} modelos`);
}

interface ClearModelsArgs {
  providerStorageAlias: string;
  customModels: CustomModelEntry[];
  modelAliases: Record<string, string>;
  setLiveModels: React.Dispatch<React.SetStateAction<LiveModel[]>>;
  setSuggestedModels: React.Dispatch<React.SetStateAction<SuggestedModel[]>>;
  setCustomModels: React.Dispatch<React.SetStateAction<CustomModelEntry[]>>;
  setModelAliases: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setDisabledModelIds: React.Dispatch<React.SetStateAction<string[]>>;
  onClearTestResults: () => void;
  notify: { error: (msg: string) => void; success: (msg: string) => void };
}

export async function clearProviderModels({
  providerStorageAlias, customModels, modelAliases,
  setLiveModels, setSuggestedModels, setCustomModels, setModelAliases, setDisabledModelIds,
  onClearTestResults, notify,
}: ClearModelsArgs): Promise<void> {
  const providerCustomModels = customModels.filter((m) => m.providerAlias === providerStorageAlias && (m.kind || m.type || "llm") === "llm");
  const providerAliases = Object.entries(modelAliases).filter(([, m]) => typeof m === "string" && m.startsWith(`${providerStorageAlias}/`)).map(([alias]) => alias);
  await Promise.all([
    ...providerCustomModels.map((m) => fetch(`/api/models/custom?${new URLSearchParams({ providerAlias: providerStorageAlias, id: m.id, type: m.kind || m.type || "llm" })}`, { method: "DELETE" })),
    ...providerAliases.map((alias) => fetch(`/api/models/alias?alias=${encodeURIComponent(alias)}`, { method: "DELETE" })),
  ]);

  const clearDisabledResponse = await fetch(`/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}`, { method: "DELETE" });
  if (!clearDisabledResponse.ok) throw new Error("Failed to clear disabled models");

  const response = await fetch("/api/models/disabled", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerAlias: providerStorageAlias, ids: [CLEAR_ALL_MODELS_SENTINEL] }) });
  if (!response.ok) throw new Error("Failed to clear models");

  setLiveModels([]);
  setSuggestedModels([]);
  setCustomModels((current) => current.filter((m) => m.providerAlias !== providerStorageAlias));
  setModelAliases((current) => Object.fromEntries(Object.entries(current).filter(([, m]) => !String(m).startsWith(`${providerStorageAlias}/`))));
  setDisabledModelIds([CLEAR_ALL_MODELS_SENTINEL]);
  onClearTestResults();
  notify.success(translate("All models cleared. Refresh Models to load the current upstream catalog.") || "All models cleared. Refresh Models to load the current upstream catalog.");
}

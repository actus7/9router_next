"use client";

import { useEffect, useState } from "react";
import { translate } from "@/i18n/runtime";
import { useNotificationStore } from "@/store/notificationStore";
import { fetchSuggestedModels, type ModelsFetcher } from "@/shared/utils/providerModelsFetcher";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { refreshModels, clearProviderModels } from "./modelRefreshHelpers";
import { importQoderModels } from "./qoderImportHelper";
import type { Connection, CustomModelEntry, LiveModel, ProviderNode, SuggestedModel } from "../types";

interface UseModelDiscoveryArgs {
  providerId: string;
  providerStorageAlias: string;
  isCompatible: boolean;
  isAnthropicCompatible: boolean;
  connections: Connection[];
  providerNode: ProviderNode | null;
  staticModels: LiveModel[];
  catalogCleared: boolean;
  customModels: CustomModelEntry[];
  modelAliases: Record<string, string>;
  disabledModelIds: string[];
  onAddCustomModel: (modelId: string, type?: string, providerAlias?: string) => Promise<void>;
  onFetchDisabledModels: () => Promise<void>;
  onClearTestResults: () => void;
  setCustomModels: React.Dispatch<React.SetStateAction<CustomModelEntry[]>>;
  setModelAliases: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setDisabledModelIds: React.Dispatch<React.SetStateAction<string[]>>;
}

export function useModelDiscovery({
  providerId, providerStorageAlias, isCompatible, isAnthropicCompatible, connections, providerNode,
  staticModels, catalogCleared, customModels, modelAliases, disabledModelIds,
  onAddCustomModel, onFetchDisabledModels, onClearTestResults,
  setCustomModels, setModelAliases, setDisabledModelIds,
}: UseModelDiscoveryArgs) {
  const notify = useNotificationStore();
  const [suggestedModels, setSuggestedModels] = useState<SuggestedModel[]>([]);
  const [liveModels, setLiveModels] = useState<LiveModel[]>([]);
  const [kiloFreeModels, setKiloFreeModels] = useState<LiveModel[]>([]);
  const [refreshingModels, setRefreshingModels] = useState<boolean>(false);
  const [importingQoderModels, setImportingQoderModels] = useState<boolean>(false);
  const [clearingModels, setClearingModels] = useState<boolean>(false);

  useEffect(() => {
    if (providerId !== "kilocode") return;
    fetch("/api/providers/kilo/free-models").then((res) => res.json()).then((data) => { if (data.models?.length) setKiloFreeModels(data.models); }).catch(() => {});
  }, [providerId]);

  useEffect(() => {
    if (providerId !== "cursor") { setLiveModels([]); return; }
    const connection = connections.find((item) => item.isActive !== false);
    if (!connection?.id) { setLiveModels([]); return; }
    let cancelled = false;
    fetch(`/api/providers/${connection.id}/models`, { cache: "no-store" })
      .then(async (res) => ({ ok: res.ok, data: await res.json() }))
      .then(({ ok, data }) => { if (!cancelled && ok && Array.isArray(data.models) && data.models.length > 0) setLiveModels(data.models); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [providerId, connections]);

  useEffect(() => {
    if (catalogCleared) { setSuggestedModels([]); return; }
    const fetcher = AI_PROVIDERS[providerId]?.modelsFetcher as ModelsFetcher | undefined;
    if (!fetcher) return;
    const hasNoStaticCatalog = staticModels.length === 0;
    fetchSuggestedModels(fetcher).then((result) => { setSuggestedModels(result); if (hasNoStaticCatalog) setLiveModels(result as LiveModel[]); });
  }, [providerId, catalogCleared, staticModels.length]);

  const handleImportQoderModels = async () => {
    if (importingQoderModels) return;
    setImportingQoderModels(true);
    try { await importQoderModels(connections, providerStorageAlias, customModels, modelAliases, onAddCustomModel, notify); }
    catch (error: unknown) { console.error("Error importing Qoder models:", error); notify.error(translate("Error fetching models") + ": " + (error instanceof Error ? error.message : String(error))); }
    finally { setImportingQoderModels(false); }
  };

  const handleRefreshModels = async () => {
    if (refreshingModels) return;
    setRefreshingModels(true);
    try { await refreshModels({ providerId, providerStorageAlias, isCompatible, connections, providerNode, customModels, modelAliases, setLiveModels, setCustomModels, setModelAliases, onFetchDisabledModels, notify }); }
    catch (error: unknown) { console.error("Error refreshing models:", error); notify.error(translate("Error fetching models") + ": " + (error instanceof Error ? error.message : String(error))); }
    finally { setRefreshingModels(false); }
  };

  const handleClearProviderModels = async () => {
    if (clearingModels) return;
    setClearingModels(true);
    try { await clearProviderModels({ providerStorageAlias, customModels, modelAliases, setLiveModels, setSuggestedModels, setCustomModels, setModelAliases, setDisabledModelIds, onClearTestResults, notify }); }
    catch (error) { console.error("Error clearing provider models:", error); notify.error(translate("Failed to clear models") || "Failed to clear models"); }
    finally { setClearingModels(false); }
  };

  return {
    suggestedModels, liveModels, kiloFreeModels,
    refreshingModels, importingQoderModels, clearingModels,
    handleRefreshModels, handleImportQoderModels, handleClearProviderModels,
  };
}

export type UseModelDiscoveryReturn = ReturnType<typeof useModelDiscovery>;

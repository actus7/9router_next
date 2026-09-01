"use client";

import { useCallback, useState } from "react";
import { useNotificationStore } from "@/store/notificationStore";
import { addCustomModelApi, deleteCustomModelApi, deleteAliasApi } from "./customModelActions";
import type { CustomModelEntry } from "../types";

interface UseCustomModelsArgs {
  providerStorageAlias: string;
  initialAliases: Record<string, string>;
  initialCustomModels: CustomModelEntry[];
}

export function useCustomModels({ providerStorageAlias, initialAliases, initialCustomModels }: UseCustomModelsArgs) {
  const notify = useNotificationStore();
  const [modelAliases, setModelAliases] = useState<Record<string, string>>(initialAliases);
  const [customModels, setCustomModels] = useState<CustomModelEntry[]>(initialCustomModels);

  const fetchAliases = useCallback(async () => {
    try { const res = await fetch("/api/models/alias"); const data = await res.json(); if (res.ok) setModelAliases(data.aliases || {}); }
    catch (error) { console.error("Error fetching aliases:", error); }
  }, []);

  const fetchCustomModels = useCallback(async () => {
    try { const res = await fetch("/api/models/custom", { cache: "no-store" }); const data = await res.json(); if (res.ok) setCustomModels(data.models || []); }
    catch (error) { console.error("Error fetching custom models:", error); }
  }, []);

  const handleDeleteAlias = async (alias: string) => {
    if (await deleteAliasApi(alias)) await fetchAliases();
  };

  const handleAddCustomModel = async (
    modelId: string, type: string = "llm", providerAliasOverride: string = providerStorageAlias,
    source: "manual" | "discovered" = "manual", modelData?: Record<string, unknown>,
  ) => {
    const result = await addCustomModelApi(providerAliasOverride, modelId, type, source, modelData);
    if (result.ok) { await fetchCustomModels(); if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("customModelChanged")); }
    else notify.error(result.error || "Failed to add custom model");
  };

  const handleDeleteCustomModel = async (modelId: string, type: string = "llm", providerAliasOverride: string = providerStorageAlias) => {
    if (await deleteCustomModelApi(providerAliasOverride, modelId, type)) {
      await fetchCustomModels();
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("customModelChanged"));
    }
  };

  return {
    modelAliases, setModelAliases, customModels, setCustomModels,
    fetchAliases, fetchCustomModels, handleDeleteAlias, handleAddCustomModel, handleDeleteCustomModel,
  };
}

export type UseCustomModelsReturn = ReturnType<typeof useCustomModels>;

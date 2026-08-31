"use client";

import { useCallback, useState } from "react";
import { useNotificationStore } from "@/store/notificationStore";
import type { CustomModelEntry } from "../types";

interface UseCustomModelsArgs {
  providerStorageAlias: string;
  initialAliases: Record<string, string>;
  initialCustomModels: CustomModelEntry[];
}

export function useCustomModels({
  providerStorageAlias,
  initialAliases,
  initialCustomModels,
}: UseCustomModelsArgs) {
  const notify = useNotificationStore();
  const [modelAliases, setModelAliases] = useState<Record<string, string>>(initialAliases);
  const [customModels, setCustomModels] = useState<CustomModelEntry[]>(initialCustomModels);

  const fetchAliases = useCallback(async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) {
        setModelAliases(data.aliases || {});
      }
    } catch (error) {
      console.error("Error fetching aliases:", error);
    }
  }, []);

  const fetchCustomModels = useCallback(async () => {
    try {
      const res = await fetch("/api/models/custom", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setCustomModels(data.models || []);
      }
    } catch (error) {
      console.error("Error fetching custom models:", error);
    }
  }, []);

  const handleDeleteAlias = async (alias: string) => {
    try {
      const res = await fetch(`/api/models/alias?alias=${encodeURIComponent(alias)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchAliases();
      }
    } catch (error) {
      console.error("Error deleting alias:", error);
    }
  };

  const handleAddCustomModel = async (
    modelId: string,
    type: string = "llm",
    providerAliasOverride: string = providerStorageAlias,
    source: "manual" | "discovered" = "manual",
    modelData?: Record<string, unknown>,
  ) => {
    try {
      const res = await fetch("/api/models/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerAlias: providerAliasOverride,
          id: modelId,
          type,
          source,
          name: typeof modelData?.name === "string" ? modelData.name : modelId,
          metadata: modelData,
        }),
      });
      if (res.ok) {
        await fetchCustomModels();
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("customModelChanged"));
      } else {
        const data = await res.json();
        notify.error(data.error || "Failed to add custom model");
      }
    } catch (error) {
      console.error("Error adding custom model:", error);
    }
  };

  const handleDeleteCustomModel = async (modelId: string, type: string = "llm", providerAliasOverride: string = providerStorageAlias) => {
    try {
      const params = new URLSearchParams({ providerAlias: providerAliasOverride, id: modelId, type });
      const res = await fetch(`/api/models/custom?${params}`, { method: "DELETE" });
      if (res.ok) {
        await fetchCustomModels();
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("customModelChanged"));
      }
    } catch (error) {
      console.error("Error deleting custom model:", error);
    }
  };

  return {
    modelAliases,
    setModelAliases,
    customModels,
    setCustomModels,
    fetchAliases,
    fetchCustomModels,
    handleDeleteAlias,
    handleAddCustomModel,
    handleDeleteCustomModel,
  };
}

export type UseCustomModelsReturn = ReturnType<typeof useCustomModels>;

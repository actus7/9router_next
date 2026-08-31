"use client";

import { useCallback, useState } from "react";

interface UseDisabledModelsArgs {
  providerStorageAlias: string;
  providerAlias: string;
  initialDisabledModels: Record<string, string[]>;
}

export function useDisabledModels({
  providerStorageAlias,
  providerAlias,
  initialDisabledModels,
}: UseDisabledModelsArgs) {
  const [disabledModelIds, setDisabledModelIds] = useState<string[]>(
    initialDisabledModels[providerStorageAlias] || initialDisabledModels[providerAlias] || [],
  );

  const fetchDisabledModels = useCallback(async () => {
    try {
      const res = await fetch(`/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setDisabledModelIds(data.ids || []);
    } catch (error) {
      console.error("Error fetching disabled models:", error);
    }
  }, [providerStorageAlias]);

  const handleDisableModel = async (modelId: string) => {
    try {
      const res = await fetch("/api/models/disabled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias: providerStorageAlias, ids: [modelId] }),
      });
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.error("Error disabling model:", error);
    }
  };

  const handleEnableModel = async (modelId: string) => {
    try {
      const res = await fetch(`/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}&id=${encodeURIComponent(modelId)}`, { method: "DELETE" });
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.error("Error enabling model:", error);
    }
  };

  const handleDisableAll = async (ids: string[]) => {
    if (!ids.length) return;
    try {
      const res = await fetch("/api/models/disabled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias: providerStorageAlias, ids }),
      });
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.error("Error disabling all models:", error);
    }
  };

  const handleEnableAll = async () => {
    try {
      const res = await fetch(`/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}`, { method: "DELETE" });
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.error("Error enabling all models:", error);
    }
  };

  return {
    disabledModelIds,
    setDisabledModelIds,
    fetchDisabledModels,
    handleDisableModel,
    handleEnableModel,
    handleDisableAll,
    handleEnableAll,
  };
}

export type UseDisabledModelsReturn = ReturnType<typeof useDisabledModels>;

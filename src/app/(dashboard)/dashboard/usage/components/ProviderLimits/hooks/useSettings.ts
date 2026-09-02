"use client";

import { useState, useEffect, useCallback } from "react";
import useSWR from "swr";
import { jsonFetcher } from "@/shared/hooks/jsonFetcher";
import {
  getQuotaVisibilityKey,
  type QuotaEntry,
} from "../utils";

const AUTO_PING_SETTINGS_KEYS: Record<string, string> = {
  claude: "claudeAutoPing",
  codex: "codexAutoPing",
};
import type { UseSettingsReturn } from "../types";

export function useSettings(): UseSettingsReturn {
  const [autoPingMaps, setAutoPingMaps] = useState<Record<string, Record<string, boolean>>>({ claude: {}, codex: {} });
  const [quotaVisibility, setQuotaVisibility] = useState<Record<string, { hidden?: string[] }>>({});
  const { data: settings, mutate: mutateSettings } = useSWR<Record<string, unknown>>(
    "/api/settings",
    jsonFetcher,
  );

  // Hydrate feature state from the same shared settings request used by the dashboard shell.
  useEffect(() => {
    if (!settings) return;
    const sClaude = settings.claudeAutoPing as Record<string, unknown> | undefined;
    const sCodex = settings.codexAutoPing as Record<string, unknown> | undefined;
    setAutoPingMaps({
      claude: (sClaude?.connections as Record<string, boolean>) || {},
      codex: (sCodex?.connections as Record<string, boolean>) || {},
    });
    setQuotaVisibility((settings.quotaVisibility as Record<string, { hidden?: string[] }>) || {});
  }, [settings]);

  const toggleAutoPing = useCallback(async (connectionId: string, provider: string, on: boolean) => {
    const settingsKey = AUTO_PING_SETTINGS_KEYS[provider];
    if (!settingsKey) return;

    const previous = autoPingMaps;
    const nextProviderMap = { ...(autoPingMaps[provider] || {}), [connectionId]: on };
    const nextMaps = { ...autoPingMaps, [provider]: nextProviderMap };
    setAutoPingMaps(nextMaps);
    try {
      const currentConfig = (settings?.[settingsKey] as Record<string, unknown> | undefined) || {};
      const cfg = { ...currentConfig, connections: nextProviderMap };
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [settingsKey]: cfg }),
      });
      if (!response.ok) throw new Error("Failed to update auto-ping setting");
      await mutateSettings(
        (current) => ({ ...current, [settingsKey]: cfg }),
        { revalidate: false },
      );
    } catch {
      setAutoPingMaps(previous);
    }
  }, [autoPingMaps, mutateSettings, settings]);

  const updateQuotaVisibility = useCallback(async (nextVisibility: Record<string, { hidden?: string[] }>, previousVisibility: Record<string, { hidden?: string[] }>) => {
    setQuotaVisibility(nextVisibility);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quotaVisibility: nextVisibility }),
      });
      if (!response.ok) throw new Error("Failed to update quota visibility");
      await mutateSettings(
        (current) => ({ ...current, quotaVisibility: nextVisibility }),
        { revalidate: false },
      );
    } catch (error) {
      console.error("Error updating quota visibility:", error);
      setQuotaVisibility(previousVisibility);
    }
  }, [mutateSettings]);

  const handleHideQuota = useCallback((provider: string, quota: QuotaEntry) => {
    const key = getQuotaVisibilityKey(quota);
    if (!provider || !key) return;

    const previous = quotaVisibility;
    const providerVisibility = previous[provider] || {};
    const hidden = new Set(providerVisibility.hidden || []);
    hidden.add(key);
    const next = {
      ...previous,
      [provider]: {
        ...providerVisibility,
        hidden: [...hidden],
      },
    };
    updateQuotaVisibility(next, previous);
  }, [quotaVisibility, updateQuotaVisibility]);

  const handleShowQuota = useCallback((provider: string, quota: QuotaEntry) => {
    const key = getQuotaVisibilityKey(quota);
    if (!provider || !key) return;

    const previous = quotaVisibility;
    const providerVisibility = previous[provider] || {};
    const hidden = new Set(providerVisibility.hidden || []);
    hidden.delete(key);
    const next = {
      ...previous,
      [provider]: {
        ...providerVisibility,
        hidden: [...hidden],
      },
    };
    updateQuotaVisibility(next, previous);
  }, [quotaVisibility, updateQuotaVisibility]);

  return {
    autoPingMaps,
    quotaVisibility,
    toggleAutoPing,
    handleHideQuota,
    handleShowQuota,
  };
}

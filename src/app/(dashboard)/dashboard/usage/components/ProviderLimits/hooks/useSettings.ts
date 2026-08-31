"use client";

import { useState, useEffect, useCallback } from "react";
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

  // Load auto-ping per-connection maps and quota visibility
  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((s: Record<string, unknown>) => {
        const sClaude = s?.claudeAutoPing as Record<string, unknown> | undefined;
        const sCodex = s?.codexAutoPing as Record<string, unknown> | undefined;
        setAutoPingMaps({
          claude: (sClaude?.connections as Record<string, boolean>) || {},
          codex: (sCodex?.connections as Record<string, boolean>) || {},
        });
        setQuotaVisibility((s?.quotaVisibility as Record<string, { hidden?: string[] }>) || {});
      })
      .catch(() => {});
  }, []);

  const toggleAutoPing = useCallback(async (connectionId: string, provider: string, on: boolean) => {
    const settingsKey = AUTO_PING_SETTINGS_KEYS[provider];
    if (!settingsKey) return;

    const previous = autoPingMaps;
    const nextProviderMap = { ...(autoPingMaps[provider] || {}), [connectionId]: on };
    const nextMaps = { ...autoPingMaps, [provider]: nextProviderMap };
    setAutoPingMaps(nextMaps);
    try {
      const r = await fetch("/api/settings", { cache: "no-store" });
      const s = r.ok ? await r.json() : {};
      const cfg = { ...(s[settingsKey] || {}), connections: nextProviderMap };
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [settingsKey]: cfg }),
      });
    } catch {
      setAutoPingMaps(previous);
    }
  }, [autoPingMaps]);

  const updateQuotaVisibility = useCallback(async (nextVisibility: Record<string, { hidden?: string[] }>, previousVisibility: Record<string, { hidden?: string[] }>) => {
    setQuotaVisibility(nextVisibility);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quotaVisibility: nextVisibility }),
      });
      if (!response.ok) throw new Error("Failed to update quota visibility");
    } catch (error) {
      console.error("Error updating quota visibility:", error);
      setQuotaVisibility(previousVisibility);
    }
  }, []);

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

"use client";

import { useState } from "react";
import type { AutoPingConfig } from "../types";

const AUTO_PING_SETTINGS_KEYS: Record<string, string> = {
  claude: "claudeAutoPing",
  codex: "codexAutoPing",
};

interface UseProviderSettingsArgs {
  providerId: string;
  initialSettings: Record<string, unknown>;
}

export function useProviderSettings({
  providerId,
  initialSettings,
}: UseProviderSettingsArgs) {
  const settingsOverride = ((initialSettings.providerStrategies as Record<string, Record<string, unknown>>) || {})[providerId] || {};
  const thinkingCfg = ((initialSettings.providerThinking as Record<string, Record<string, unknown>>) || {})[providerId] || {};
  const autoPingSettingsKey = AUTO_PING_SETTINGS_KEYS[providerId];
  const apCfg = autoPingSettingsKey ? ((initialSettings[autoPingSettingsKey] as Record<string, unknown>) || {}) : {};

  const [providerStrategy, setProviderStrategy] = useState<string | null>((settingsOverride.fallbackStrategy as string) || null);
  const [providerStickyLimit, setProviderStickyLimit] = useState<string>(settingsOverride.stickyRoundRobinLimit != null ? String(settingsOverride.stickyRoundRobinLimit) : "1");
  const [thinkingMode, setThinkingMode] = useState<string>((thinkingCfg.mode as string) || "auto");
  const [autoPing, setAutoPing] = useState<AutoPingConfig>({ enabled: apCfg.enabled === true, connections: (apCfg.connections as Record<string, boolean>) || {} });

  const hasAutoPing = !!AUTO_PING_SETTINGS_KEYS[providerId];

  const saveProviderStrategy = async (strategy: string | null, stickyLimit: string) => {
    try {
      const settingsRes = await fetch("/api/settings", { cache: "no-store" });
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      const current = settingsData.providerStrategies || {};

      const override: Record<string, unknown> = {};
      if (strategy) override.fallbackStrategy = strategy;
      if (strategy === "round-robin" && stickyLimit !== "") {
        override.stickyRoundRobinLimit = Number(stickyLimit) || 3;
      }

      const updated = { ...current };
      if (Object.keys(override).length === 0) {
        delete updated[providerId];
      } else {
        updated[providerId] = override;
      }

      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerStrategies: updated }),
      });
    } catch (error) {
      console.error("Error saving provider strategy:", error);
    }
  };

  const handleRoundRobinToggle = (enabled: boolean) => {
    const strategy = enabled ? "round-robin" : null;
    const sticky = enabled ? (providerStickyLimit || "1") : providerStickyLimit;
    if (enabled && !providerStickyLimit) setProviderStickyLimit("1");
    setProviderStrategy(strategy);
    saveProviderStrategy(strategy, sticky);
  };

  const handleStickyLimitChange = (value: string) => {
    setProviderStickyLimit(value);
    saveProviderStrategy("round-robin", value);
  };

  const saveThinkingConfig = async (mode: string) => {
    try {
      const settingsRes = await fetch("/api/settings", { cache: "no-store" });
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      const current = settingsData.providerThinking || {};
      const updated = { ...current };
      if (!mode || mode === "auto") {
        delete updated[providerId];
      } else {
        updated[providerId] = { mode };
      }
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerThinking: updated }),
      });
    } catch (error) {
      console.error("Error saving thinking config:", error);
    }
  };

  const handleThinkingModeChange = (mode: string) => {
    setThinkingMode(mode);
    saveThinkingConfig(mode);
  };

  const saveAutoPing = async (next: AutoPingConfig) => {
    const apKey = AUTO_PING_SETTINGS_KEYS[providerId];
    if (!apKey) return;

    setAutoPing(next);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [apKey]: next }),
      });
    } catch (error) {
      console.error("Error saving auto-ping config:", error);
    }
  };

  const handleAutoPingConnection = (connectionId: string, on: boolean) => {
    saveAutoPing({ ...autoPing, connections: { ...autoPing.connections, [connectionId]: on } });
  };

  // Called by fetchConnections to hydrate settings from a combined API response.
  const loadSettings = (settingsData: Record<string, unknown>) => {
    const strategies = (settingsData.providerStrategies as Record<string, Record<string, unknown>>) || {};
    const override = strategies[providerId] || {};
    setProviderStrategy((override.fallbackStrategy as string) || null);
    setProviderStickyLimit(override.stickyRoundRobinLimit != null ? String(override.stickyRoundRobinLimit) : "1");
    const thinking = (settingsData.providerThinking as Record<string, Record<string, unknown>>) || {};
    const thCfg = thinking[providerId] || {};
    setThinkingMode((thCfg.mode as string) || "auto");
    const apKey = AUTO_PING_SETTINGS_KEYS[providerId];
    const apData = apKey ? ((settingsData[apKey] as Record<string, unknown>) || {}) : {};
    setAutoPing({ enabled: apData.enabled === true, connections: (apData.connections as Record<string, boolean>) || {} });
  };

  return {
    providerStrategy,
    providerStickyLimit,
    thinkingMode,
    autoPing,
    hasAutoPing,
    autoPingSettingsKey: AUTO_PING_SETTINGS_KEYS[providerId],
    loadSettings,
    handleRoundRobinToggle,
    handleStickyLimitChange,
    handleThinkingModeChange,
    handleAutoPingConnection,
  };
}

export { AUTO_PING_SETTINGS_KEYS };
export type UseProviderSettingsReturn = ReturnType<typeof useProviderSettings>;

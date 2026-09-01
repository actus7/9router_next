"use client";

import { useState } from "react";
import { saveProviderStrategy, saveThinkingConfig, saveAutoPingSetting } from "./settingsActions";
import type { AutoPingConfig } from "../types";

const AUTO_PING_SETTINGS_KEYS: Record<string, string> = {
  claude: "claudeAutoPing",
  codex: "codexAutoPing",
};

interface UseProviderSettingsArgs {
  providerId: string;
  initialSettings: Record<string, unknown>;
}

export function useProviderSettings({ providerId, initialSettings }: UseProviderSettingsArgs) {
  const settingsOverride = ((initialSettings.providerStrategies as Record<string, Record<string, unknown>>) || {})[providerId] || {};
  const thinkingCfg = ((initialSettings.providerThinking as Record<string, Record<string, unknown>>) || {})[providerId] || {};
  const autoPingSettingsKey = AUTO_PING_SETTINGS_KEYS[providerId];
  const apCfg = autoPingSettingsKey ? ((initialSettings[autoPingSettingsKey] as Record<string, unknown>) || {}) : {};

  const [providerStrategy, setProviderStrategy] = useState<string | null>((settingsOverride.fallbackStrategy as string) || null);
  const [providerStickyLimit, setProviderStickyLimit] = useState<string>(settingsOverride.stickyRoundRobinLimit != null ? String(settingsOverride.stickyRoundRobinLimit) : "1");
  const [thinkingMode, setThinkingMode] = useState<string>((thinkingCfg.mode as string) || "auto");
  const [autoPing, setAutoPing] = useState<AutoPingConfig>({ enabled: apCfg.enabled === true, connections: (apCfg.connections as Record<string, boolean>) || {} });

  const hasAutoPing = !!AUTO_PING_SETTINGS_KEYS[providerId];

  const handleRoundRobinToggle = (enabled: boolean) => {
    const strategy = enabled ? "round-robin" : null;
    const sticky = enabled ? (providerStickyLimit || "1") : providerStickyLimit;
    if (enabled && !providerStickyLimit) setProviderStickyLimit("1");
    setProviderStrategy(strategy);
    saveProviderStrategy(providerId, strategy, sticky);
  };

  const handleStickyLimitChange = (value: string) => {
    setProviderStickyLimit(value);
    saveProviderStrategy(providerId, "round-robin", value);
  };

  const handleThinkingModeChange = (mode: string) => {
    setThinkingMode(mode);
    saveThinkingConfig(providerId, mode);
  };

  const handleAutoPingConnection = (connectionId: string, on: boolean) => {
    const next = { ...autoPing, connections: { ...autoPing.connections, [connectionId]: on } };
    setAutoPing(next);
    if (autoPingSettingsKey) saveAutoPingSetting(autoPingSettingsKey, next as unknown as Record<string, unknown>);
  };

  const loadSettings = (settingsData: Record<string, unknown>) => {
    const strategies = (settingsData.providerStrategies as Record<string, Record<string, unknown>>) || {};
    const override = strategies[providerId] || {};
    setProviderStrategy((override.fallbackStrategy as string) || null);
    setProviderStickyLimit(override.stickyRoundRobinLimit != null ? String(override.stickyRoundRobinLimit) : "1");
    const thinking = (settingsData.providerThinking as Record<string, Record<string, unknown>>) || {};
    setThinkingMode((thinking[providerId]?.mode as string) || "auto");
    const apKey = AUTO_PING_SETTINGS_KEYS[providerId];
    const apData = apKey ? ((settingsData[apKey] as Record<string, unknown>) || {}) : {};
    setAutoPing({ enabled: apData.enabled === true, connections: (apData.connections as Record<string, boolean>) || {} });
  };

  return {
    providerStrategy, providerStickyLimit, thinkingMode, autoPing, hasAutoPing,
    autoPingSettingsKey: AUTO_PING_SETTINGS_KEYS[providerId],
    loadSettings, handleRoundRobinToggle, handleStickyLimitChange,
    handleThinkingModeChange, handleAutoPingConnection,
  };
}

export { AUTO_PING_SETTINGS_KEYS };
export type UseProviderSettingsReturn = ReturnType<typeof useProviderSettings>;

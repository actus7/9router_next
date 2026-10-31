"use client";

import { useState } from "react";
import { translate } from "@/i18n/runtime";
import type { Settings } from "../types";

const STICKY_LIMIT_MAX = 10;
const COMBO_STICKY_LIMIT_MAX = 100;

/** A whole number from 1 to `max`, or null when the text is not one. */
export function parseLimit(raw: string, max: number): number | null {
  const value = Number(raw.trim());
  return Number.isInteger(value) && value >= 1 && value <= max ? value : null;
}

export function useProfileSettings(initialSettings: Settings) {
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const reloadSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) return;
      const data = await res.json();
      setSettings(data);
    } catch (err) {
      console.error("Falha ao recarregar configurações:", err);
    }
  };

  // The switch or field only moves once the server has kept the value; while
  // the PATCH is in flight the routing controls are disabled.
  const saveSetting = async (updates: Partial<Settings>) => {
    setLoading(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, ...updates }));
      } else {
        setSaveError(translate("Settings could not be saved") || "Settings could not be saved");
      }
    } catch (err) {
      console.error("Falha ao atualizar configurações:", err);
      setSaveError(translate("Settings could not be saved") || "Settings could not be saved");
    } finally {
      setLoading(false);
    }
  };

  const updateFreeFallbackEnabled = (enabled: boolean) => saveSetting({ freeFallbackEnabled: enabled });

  const updateFallbackStrategy = (strategy: string) => saveSetting({ fallbackStrategy: strategy });

  const updateComboStrategy = (strategy: string) => saveSetting({ comboStrategy: strategy });

  const updateStickyLimit = async (limit: string) => {
    const value = parseLimit(limit, STICKY_LIMIT_MAX);
    if (value !== null) await saveSetting({ stickyRoundRobinLimit: value });
  };

  const updateComboStickyLimit = async (limit: string) => {
    const value = parseLimit(limit, COMBO_STICKY_LIMIT_MAX);
    if (value !== null) await saveSetting({ comboStickyRoundRobinLimit: value });
  };

  const updateRequireLogin = (requireLogin: boolean) => saveSetting({ requireLogin });

  return {
    settings,
    setSettings,
    loading,
    setLoading,
    saveError,
    reloadSettings,
    updateFallbackStrategy,
    updateFreeFallbackEnabled,
    updateComboStrategy,
    updateStickyLimit,
    updateComboStickyLimit,
    updateRequireLogin,
  };
}

"use client";

import { useState } from "react";
import type { Settings } from "../types";

export function useProfileSettings(initialSettings: Settings) {
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [loading, setLoading] = useState(false);

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

  const updateFallbackStrategy = async (strategy: string) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fallbackStrategy: strategy }),
      });
      if (res.ok) {
        setSettings(prev => ({ ...prev, fallbackStrategy: strategy }));
      }
    } catch (err) {
      console.error("Falha ao atualizar configurações:", err);
    }
  };

  const updateComboStrategy = async (strategy: string) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comboStrategy: strategy }),
      });
      if (res.ok) {
        setSettings(prev => ({ ...prev, comboStrategy: strategy }));
      }
    } catch (err) {
      console.error("Falha ao atualizar estratégia de combo:", err);
    }
  };

  const updateStickyLimit = async (limit: string) => {
    const numLimit = parseInt(limit);
    if (isNaN(numLimit) || numLimit < 1) return;

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stickyRoundRobinLimit: numLimit }),
      });
      if (res.ok) {
        setSettings(prev => ({ ...prev, stickyRoundRobinLimit: numLimit }));
      }
    } catch (err) {
      console.error("Falha ao atualizar limite sticky:", err);
    }
  };

  const updateComboStickyLimit = async (limit: string) => {
    const numLimit = parseInt(limit);
    if (isNaN(numLimit) || numLimit < 1) return;

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comboStickyRoundRobinLimit: numLimit }),
      });
      if (res.ok) {
        setSettings(prev => ({ ...prev, comboStickyRoundRobinLimit: numLimit }));
      }
    } catch (err) {
      console.error("Falha ao atualizar limite sticky de combo:", err);
    }
  };

  const updateRequireLogin = async (requireLogin: boolean) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireLogin }),
      });
      if (res.ok) {
        setSettings(prev => ({ ...prev, requireLogin }));
      }
    } catch (err) {
      console.error("Falha ao atualizar exigir login:", err);
    }
  };

  const updateObservabilityEnabled = async (enabled: boolean) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enableObservability: enabled }),
      });
      if (res.ok) {
        setSettings(prev => ({ ...prev, enableObservability: enabled }));
      }
    } catch (err) {
      console.error("Falha ao atualizar habilitar observabilidade:", err);
    }
  };

  const observabilityEnabled = settings.enableObservability === true;

  return {
    settings,
    setSettings,
    loading,
    setLoading,
    reloadSettings,
    updateFallbackStrategy,
    updateComboStrategy,
    updateStickyLimit,
    updateComboStickyLimit,
    updateRequireLogin,
    updateObservabilityEnabled,
    observabilityEnabled,
  };
}

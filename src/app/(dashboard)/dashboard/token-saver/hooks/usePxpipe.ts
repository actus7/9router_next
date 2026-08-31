"use client";

import { useState, useCallback } from "react";
import type { PxpipeHealthData } from "../types";
import { patchSetting } from "../types";

export function usePxpipe() {
  const [pxpipeEnabled, setPxpipeEnabled] = useState(false);
  const [pxpipeMinChars, setPxpipeMinChars] = useState(25000);
  const [pxpipeStatus, setPxpipeStatus] = useState({
    installed: false,
    installing: false,
    running: false,
    version: null as string | null,
    loading: true,
  });
  const [pxpipeHealth, setPxpipeHealth] = useState<PxpipeHealthData | null>(null);
  const [showPxpipeModal, setShowPxpipeModal] = useState(false);
  const [pxpipeActionLoading, setPxpipeActionLoading] = useState(false);
  const [pxpipeActionError, setPxpipeActionError] = useState("");

  const refreshPxpipeStatus = useCallback(async () => {
    setPxpipeStatus((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch("/api/pxpipe/status", {
        headers: { "Cache-Control": "no-store" },
      });
      const data = await res.json();
      setPxpipeStatus({ ...data, loading: false });
      if (typeof data.minChars === "number") setPxpipeMinChars(data.minChars);
    } catch {
      setPxpipeStatus({ installed: false, installing: false, running: false, version: null, loading: false });
    }
  }, []);

  const runPxpipeHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/pxpipe/health", { method: "POST" });
      setPxpipeHealth(await res.json());
    } catch (e: unknown) {
      setPxpipeHealth({ healthy: false, checks: [], error: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const pxpipeAction = useCallback(
    async (endpoint: string) => {
      setPxpipeActionError("");
      setPxpipeActionLoading(true);
      try {
        const res = await fetch(`/api/pxpipe/${endpoint}`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `PXPIPE ${endpoint} failed`);
        await refreshPxpipeStatus();
        await runPxpipeHealth();
      } catch (e: unknown) {
        setPxpipeActionError(e instanceof Error ? e.message : String(e));
      } finally {
        setPxpipeActionLoading(false);
      }
    },
    [refreshPxpipeStatus, runPxpipeHealth]
  );

  const handlePxpipeEnabled = (value: boolean) => {
    setPxpipeEnabled(value);
    patchSetting({ pxpipeEnabled: value });
  };

  const handlePxpipeMinCharsBlur = () => {
    const next = Math.max(0, Number(pxpipeMinChars) || 25000);
    setPxpipeMinChars(next);
    patchSetting({ pxpipeMinChars: next });
  };

  const pxpipeHealthy = pxpipeHealth?.healthy === true;
  const pxpipeStatusLabel = pxpipeStatus.loading
    ? "Checking…"
    : pxpipeStatus.installing
      ? "Installing…"
      : !pxpipeStatus.installed
        ? "Not installed"
        : pxpipeHealthy
          ? "Healthy"
          : pxpipeStatus.running
            ? "Running"
            : "Stopped";
  const pxpipeChipClass =
    pxpipeHealthy || pxpipeStatus.running
      ? "bg-success/15 text-success"
      : "bg-warning/15 text-warning";

  return {
    pxpipeEnabled, setPxpipeEnabled, pxpipeMinChars, setPxpipeMinChars,
    pxpipeStatus, pxpipeHealth, showPxpipeModal, setShowPxpipeModal,
    pxpipeActionLoading, pxpipeActionError,
    pxpipeHealthy, pxpipeStatusLabel, pxpipeChipClass,
    refreshPxpipeStatus, runPxpipeHealth, pxpipeAction,
    handlePxpipeEnabled, handlePxpipeMinCharsBlur,
  };
}

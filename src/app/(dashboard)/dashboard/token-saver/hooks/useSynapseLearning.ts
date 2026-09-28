"use client";

import { useState } from "react";
import useSWR from "swr";
import { jsonFetcher } from "@/shared/hooks/jsonFetcher";

export interface LearnedCapability {
  id: string;
  canonicalInput: string;
  answer: string;
  status: "shadow" | "active" | "deprecated";
  shadowRuns: number;
  shadowAgreements: number;
  served: number;
  rejections: number;
  source: "heuristic" | "jev";
  updatedAt: string;
}

const CAPS_URL = "/api/synapse/capabilities";

async function send(url: string, init: RequestInit): Promise<boolean> {
  try {
    return (await fetch(url, init)).ok;
  } catch {
    return false;
  }
}

/** Synapse Loop controls: the auto-learning switch and what this account learned. */
export function useSynapseLearning(initialEnabled: boolean) {
  const [enabled, setEnabledState] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const { data, isLoading, mutate } = useSWR<{ capabilities: LearnedCapability[] }>(CAPS_URL, jsonFetcher);

  const setEnabled = async (value: boolean) => {
    setSaving(true);
    const ok = await send("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ synapseLearningEnabled: value }),
    });
    if (ok) setEnabledState(value);
    setSaving(false);
  };

  const setStatus = async (id: string, status: "shadow" | "deprecated") => {
    await send(`${CAPS_URL}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await mutate();
  };

  return {
    enabled,
    syncEnabled: setEnabledState,
    saving,
    loading: isLoading,
    capabilities: data?.capabilities ?? [],
    setEnabled,
    retire: (id: string) => setStatus(id, "deprecated"),
    reactivate: (id: string) => setStatus(id, "shadow"),
    remove: async (id: string) => {
      await send(`${CAPS_URL}/${encodeURIComponent(id)}`, { method: "DELETE" });
      await mutate();
    },
    forgetAll: async () => {
      await send(CAPS_URL, { method: "DELETE" });
      await mutate();
    },
  };
}

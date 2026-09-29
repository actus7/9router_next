"use client";

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

/**
 * What the Synapse Loop learned for this account. The learning switch itself
 * moved to each API key and each conversation; what was learned stays shared
 * by the account, so it is reviewed here once.
 */
export function useLearnedAnswers() {
  const { data, isLoading, mutate } = useSWR<{ capabilities: LearnedCapability[] }>(CAPS_URL, jsonFetcher);

  const setStatus = async (id: string, status: "shadow" | "deprecated") => {
    await send(`${CAPS_URL}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await mutate();
  };

  return {
    loading: isLoading,
    capabilities: data?.capabilities ?? [],
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

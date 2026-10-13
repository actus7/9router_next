"use client";

import { useEffect, useState } from "react";

/**
 * What both model pickers need from the server besides the connections the
 * page already passed in: provider nodes, discovered/custom models, and the
 * models switched off per provider.
 *
 * Each picker used to fetch these on every open, and the custom-model list is
 * the whole discovered catalogue (about 400 kB for an account with a gateway
 * connected) — so every "add model" click waited on a Neon round trip and a
 * large parse before the list appeared. One copy per tab now: loaded when the
 * first picker mounts (before anyone clicks), shown at once on every open, and
 * revalidated in the background so a model switched off a minute ago still
 * disappears.
 */
export interface PickerCatalog {
  providerNodes: { id: string; name?: string; prefix?: string }[];
  customModels: { id: string; name?: string; providerAlias?: string }[];
  disabledModels: Record<string, string[]>;
}

const EMPTY: PickerCatalog = { providerNodes: [], customModels: [], disabledModels: {} };

let cached: PickerCatalog | null = null;
let inflight: Promise<PickerCatalog> | null = null;
const listeners = new Set<(catalog: PickerCatalog) => void>();

async function fetchField<T>(url: string, pick: (body: Record<string, unknown>) => unknown, fallback: T): Promise<T> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return fallback;
    return (pick((await response.json()) as Record<string, unknown>) as T | undefined) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Fetches a fresh copy, sharing one request between every caller that asks meanwhile. */
export function refreshPickerCatalog(): Promise<PickerCatalog> {
  if (inflight) return inflight;
  inflight = Promise.all([
    fetchField("/api/provider-nodes", (body) => body.nodes, EMPTY.providerNodes),
    fetchField("/api/models/custom", (body) => body.models, EMPTY.customModels),
    fetchField("/api/models/disabled", (body) => body.disabled, EMPTY.disabledModels),
  ])
    .then(([providerNodes, customModels, disabledModels]) => {
      cached = { providerNodes, customModels, disabledModels };
      for (const listener of listeners) listener(cached);
      return cached;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * The catalog for a picker. Starts loading on mount, so it is usually ready
 * before the first open; every open shows what is cached and refreshes it.
 */
export function usePickerCatalog(isOpen: boolean): PickerCatalog {
  const [catalog, setCatalog] = useState<PickerCatalog>(() => cached ?? EMPTY);

  useEffect(() => {
    listeners.add(setCatalog);
    if (cached) setCatalog(cached);
    else void refreshPickerCatalog();
    return () => {
      listeners.delete(setCatalog);
    };
  }, []);

  useEffect(() => {
    if (isOpen && cached) void refreshPickerCatalog();
  }, [isOpen]);

  return catalog;
}

/** Test seam: forget the copy so a test starts cold. */
export function __resetPickerCatalogForTesting(): void {
  cached = null;
  inflight = null;
  listeners.clear();
}

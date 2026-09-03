"use client";

import { useCallback, useState } from "react";
import { translate } from "@/i18n/runtime";

export interface DiscoveredModel {
  id: string;
  name?: string;
}

interface ConnectionRow {
  id: string;
  provider: string;
  isActive?: boolean;
}

/** Reads `id` off a provider models payload entry, tolerating `{name}`-only rows. */
function toDiscoveredModel(entry: unknown): DiscoveredModel | null {
  if (typeof entry === "string") return entry.trim() ? { id: entry.trim() } : null;
  if (!entry || typeof entry !== "object") return null;
  const row = entry as Record<string, unknown>;
  const id = typeof row.id === "string" && row.id
    ? row.id
    : typeof row.name === "string" && row.name
      ? row.name
      : "";
  if (!id) return null;
  return { id, name: typeof row.name === "string" ? row.name : undefined };
}

/**
 * Lists the models a provider actually exposes, for the media-provider detail
 * pages. Those pages could previously only show the hard-coded registry list,
 * so anything the provider added had to be typed in by hand.
 */
export function useModelDiscovery(providerId: string) {
  const [models, setModels] = useState<DiscoveredModel[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const discover = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const connectionsResponse = await fetch("/api/providers", { cache: "no-store" });
      const connectionsPayload = await connectionsResponse.json().catch(() => ({}));
      if (!connectionsResponse.ok) {
        setError(translate("Failed to fetch models") || "Failed to fetch models");
        return;
      }
      const rows = (connectionsPayload.connections || []) as ConnectionRow[];
      const forProvider = rows.filter((row) => row.provider === providerId);
      const connection = forProvider.find((row) => row.isActive !== false) ?? forProvider[0];
      if (!connection) {
        setError(
          translate("Connect this provider first to list its models.")
            || "Connect this provider first to list its models.",
        );
        return;
      }

      const response = await fetch(`/api/providers/${connection.id}/models`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(
          (payload.error as string)
            || translate("Failed to fetch models")
            || "Failed to fetch models",
        );
        return;
      }

      const discovered = (Array.isArray(payload.models) ? payload.models : [])
        .map(toDiscoveredModel)
        .filter((model: DiscoveredModel | null): model is DiscoveredModel => model !== null);
      setModels(discovered);
      if (discovered.length === 0) {
        setError(translate("No models found") || "No models found");
      }
    } catch {
      setError(translate("Failed to fetch models") || "Failed to fetch models");
    } finally {
      setLoading(false);
    }
  }, [providerId]);

  const reset = useCallback(() => {
    setModels(null);
    setError("");
  }, []);

  return { models, loading, error, discover, reset };
}

export { toDiscoveredModel };

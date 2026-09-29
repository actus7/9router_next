"use client";

import { useCallback, useEffect, useState } from "react";
import type { GatewayProfile } from "@/shared/gateway/gatewayProfile";

export interface UseKeyProfileReturn {
  profile: GatewayProfile | null;
  loading: boolean;
  saving: boolean;
  error: string;
  save: (patch: Partial<GatewayProfile>) => Promise<void>;
}

/**
 * One API key's gateway profile: its abilities and the skills its requests
 * carry. Loaded when a key is picked; saved optimistically and rolled back —
 * with the error shown — when the server refuses.
 */
export function useKeyProfile(keyId: string | null): UseKeyProfileReturn {
  const [profile, setProfile] = useState<GatewayProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!keyId) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`/api/keys/${encodeURIComponent(keyId)}/profile`, { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as { profile?: GatewayProfile; error?: string };
        if (!response.ok || !data.profile) throw new Error(data.error || `HTTP ${response.status}`);
        if (!cancelled) setProfile(data.profile);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [keyId]);

  const save = useCallback(
    async (patch: Partial<GatewayProfile>) => {
      if (!keyId || !profile) return;
      const previous = profile;
      setProfile({ ...profile, ...patch });
      setSaving(true);
      setError("");
      try {
        const response = await fetch(`/api/keys/${encodeURIComponent(keyId)}/profile`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const data = (await response.json().catch(() => ({}))) as { profile?: GatewayProfile; error?: string };
        if (!response.ok || !data.profile) throw new Error(data.error || `HTTP ${response.status}`);
        setProfile(data.profile);
      } catch (cause) {
        setProfile(previous);
        setError(cause instanceof Error ? cause.message : "Failed to save");
      } finally {
        setSaving(false);
      }
    },
    [keyId, profile],
  );

  return { profile, loading, saving, error, save };
}

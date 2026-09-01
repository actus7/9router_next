"use client";

import { useState, useCallback } from "react";
import type { Connection } from "../utils";
import type { UseCodexResetReturn, CreditEntry, ResetConfirmState, ResetCreditsState } from "../types";

export function useCodexReset(
  fetchQuota: (connectionId: string, provider: string, opts?: { force?: boolean }) => Promise<void>,
  setErrors: React.Dispatch<React.SetStateAction<Record<string, string | null>>>,
  setLastUpdated: React.Dispatch<React.SetStateAction<Date | null>>,
): UseCodexResetReturn {
  const [resettingLimitId, setResettingLimitId] = useState<string | null>(null);
  const [resetConfirmState, setResetConfirmState] = useState<ResetConfirmState | null>(null);
  const [resetCreditsState, setResetCreditsState] = useState<ResetCreditsState | null>(null);

  const handleResetCodexLimit = useCallback(
    async (connectionId: string, provider: string) => {
      if (provider !== "codex" || resettingLimitId) return;

      setResettingLimitId(connectionId);
      setErrors((prev) => ({ ...prev, [connectionId]: null }));

      try {
        const response = await fetch(`/api/usage/${connectionId}/codex-reset-credits`, { method: "POST" });
        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(result.message || result.error || result.code || "Failed to reset Codex limit");
        }

        await fetchQuota(connectionId, provider);
        setLastUpdated(new Date());
      } catch (error: unknown) {
        setErrors((prev) => ({ ...prev, [connectionId]: error instanceof Error ? error.message : "Failed to reset Codex limit" }));
      } finally {
        setResettingLimitId(null);
      }
    },
    [fetchQuota, resettingLimitId, setErrors, setLastUpdated],
  );

  const handleViewCodexResetCredits = useCallback(async (connection: Connection) => {
    setResetCreditsState({ connection, loading: true, error: null, data: null });
    try {
      const response = await fetch(`/api/usage/${connection.id}/codex-reset-credits`, { cache: "no-store" });
      const result = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error((result.error as string) || (result.message as string) || "Failed to load Codex reset credits");
      }
      const rawCredits = Array.isArray(result.credits) ? [...result.credits] : [];
      const credits: CreditEntry[] = rawCredits.map((c: Record<string, unknown>) => ({
        status: c.status as string | undefined,
        grantedAt: c.grantedAt as string | undefined,
        expiresAt: c.expiresAt as string | undefined,
      }));
      credits.sort((a, b) => {
        const aTime = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.POSITIVE_INFINITY;
        const bTime = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.POSITIVE_INFINITY;
        return aTime - bTime;
      });
      setResetCreditsState({ connection, loading: false, error: null, data: { credits, availableCount: result.availableCount as number | undefined } });
    } catch (error: unknown) {
      setResetCreditsState({ connection, loading: false, error: error instanceof Error ? error.message : "Failed to load Codex reset credits", data: null });
    }
  }, []);

  return {
    resettingLimitId,
    resetConfirmState,
    setResetConfirmState,
    resetCreditsState,
    setResetCreditsState,
    handleResetCodexLimit,
    handleViewCodexResetCredits,
  };
}

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  parseQuotaData,
  buildLoadingState,
  filterQuotaStateByConnections,
  setQuotaCache,
  REFRESH_INTERVAL_MS,
  CLAUDE_REFRESH_INTERVAL_MS,
  AUTO_REFRESH_STORAGE_KEY,
  type Connection,
  type QuotaData,
} from "../utils";
import type { UseQuotaDataReturn } from "../types";

export function useQuotaData(
  fetchConnections: (targetPage?: number) => Promise<Connection[]>,
  page: number,
): UseQuotaDataReturn {
  const [quotaData, setQuotaData] = useState<Record<string, QuotaData>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [hasHydratedAutoRefresh, setHasHydratedAutoRefresh] = useState(false);
  const [expiringFirst, setExpiringFirst] = useState(false);
  const [quotaSortMode, setQuotaSortMode] = useState("default");

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickCountRef = useRef(0);
  const busyRef = useRef(false);
  // Stable ref for refreshAll so interval/visibility handlers never go stale
  const refreshAllRef = useRef<((force?: boolean) => Promise<void>) | null>(null);

  // Fetch quota for a specific connection
  const fetchQuota = useCallback(async (connectionId: string, provider: string, { force = false } = {}) => {
    setLoading((prev) => ({ ...prev, [connectionId]: true }));
    setErrors((prev) => ({ ...prev, [connectionId]: null }));

    try {
      const url = `/api/usage/${connectionId}${force ? "?force=1" : ""}`;
      const response = await fetch(url);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error || response.statusText;

        // Handle different error types gracefully
        if (response.status === 404) {
          // Connection not found - skip silently
          console.warn(
            `[ProviderLimits] Connection not found for ${provider}, skipping`,
          );
          return;
        }

        if (response.status === 401) {
          // Auth error - show message instead of throwing
          console.warn(
            `[ProviderLimits] Auth error for ${provider}:`,
            errorMsg,
          );
          const quotaEntry = {
            quotas: [],
            message: errorMsg,
          };
          setQuotaData((prev) => ({
            ...prev,
            [connectionId]: quotaEntry,
          }));
          setQuotaCache(connectionId, quotaEntry);
          return;
        }

        throw new Error(`HTTP ${response.status}: ${errorMsg}`);
      }

      const data = await response.json();

      // Parse quota data using provider-specific parser
      const parsedQuotas = parseQuotaData(provider, data);

      const quotaEntry = {
        quotas: parsedQuotas,
        plan: data.plan || null,
        message: data.message || null,
        raw: data,
      };

      setQuotaData((prev) => ({
        ...prev,
        [connectionId]: quotaEntry,
      }));
      setQuotaCache(connectionId, quotaEntry);
    } catch (error: unknown) {
      console.error(
        `[ProviderLimits] Error fetching quota for ${provider} (${connectionId}):`,
        error,
      );
      setErrors((prev) => ({
        ...prev,
        [connectionId]: error instanceof Error ? error.message : "Failed to fetch quota",
      }));
    } finally {
      setLoading((prev) => ({ ...prev, [connectionId]: false }));
    }
  }, []);

  // Refresh quota for a specific provider
  const refreshProvider = useCallback(
    async (connectionId: string, provider: string) => {
      await fetchQuota(connectionId, provider, { force: true });
      setLastUpdated(new Date());
    },
    [fetchQuota],
  );

  const refreshAll = useCallback(async (force = false) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setRefreshingAll(true);
    setCountdown(60);

    // Throttle Claude: poll its quota every Nth auto-tick (manual force bypasses)
    const tick = (tickCountRef.current += 1);
    const claudeEvery = Math.round(CLAUDE_REFRESH_INTERVAL_MS / REFRESH_INTERVAL_MS);
    const shouldFetch = (conn: Connection) =>
      force || conn.provider !== "claude" || tick % claudeEvery === 0;

    try {
      const visibleConnections = await fetchConnections(page);

      setLoading(buildLoadingState(visibleConnections));
      setErrors((prev) =>
        filterQuotaStateByConnections(prev, visibleConnections),
      );
      setQuotaData((prev) =>
        filterQuotaStateByConnections(prev, visibleConnections),
      );

      await Promise.all(
        visibleConnections
          .filter(shouldFetch)
          .map((conn: Connection) => fetchQuota(conn.id, conn.provider)),
      );

      setLastUpdated(new Date());
    } catch (error) {
      console.error("Error refreshing all providers:", error);
    } finally {
      busyRef.current = false;
      setRefreshingAll(false);
    }
  }, [fetchConnections, fetchQuota, page]);

  // Hydrate auto-refresh preference
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(AUTO_REFRESH_STORAGE_KEY);
    setAutoRefresh(stored === null ? true : stored === "true");
    setHasHydratedAutoRefresh(true);
  }, []);

  // Persist auto-refresh preference
  useEffect(() => {
    if (typeof window === "undefined" || !hasHydratedAutoRefresh) return;
    window.localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, String(autoRefresh));
  }, [autoRefresh, hasHydratedAutoRefresh]);

  // Keep refreshAll ref in sync so interval/visibility handlers always call the latest version
  useEffect(() => {
    refreshAllRef.current = refreshAll;
  }, [refreshAll]);

  // Helper to start intervals (shared between auto-refresh effect and visibility handler)
  const startIntervals = useCallback(() => {
    if (intervalRef.current) return; // Already running, don't duplicate
    intervalRef.current = setInterval(() => {
      refreshAllRef.current?.();
    }, REFRESH_INTERVAL_MS);
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) return 60;
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Helper to stop intervals
  const stopIntervals = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  // A single effect owns both timers and visibility changes, preventing
  // competing effects from recreating or duplicating the same intervals.
  useEffect(() => {
    const syncIntervals = () => {
      if (!hasHydratedAutoRefresh || !autoRefresh || document.hidden) {
        stopIntervals();
        return;
      }
      startIntervals();
    };

    syncIntervals();
    document.addEventListener("visibilitychange", syncIntervals);
    return () => {
      document.removeEventListener("visibilitychange", syncIntervals);
      stopIntervals();
    };
  }, [autoRefresh, hasHydratedAutoRefresh, startIntervals, stopIntervals]);

  return {
    quotaData,
    setQuotaData,
    loading,
    setLoading,
    errors,
    setErrors,
    lastUpdated,
    setLastUpdated,
    refreshingAll,
    countdown,
    autoRefresh,
    setAutoRefresh,
    hasHydratedAutoRefresh,
    expiringFirst,
    setExpiringFirst,
    quotaSortMode,
    setQuotaSortMode,
    fetchQuota,
    refreshProvider,
    refreshAll,
  };
}

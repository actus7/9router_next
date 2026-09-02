"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import useSWR from "swr";
import { useSearchParams, useRouter } from "next/navigation";
import { jsonFetcher } from "@/shared/hooks/jsonFetcher";
import { buildConnectedProviders } from "./usageStatsProviders";

export function useUsageStatsData(period: string) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sortBy = searchParams.get("sortBy") || "rawModel";
  const sortOrder = searchParams.get("sortOrder") || "asc";
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const hasLoadedStats = useRef(false);

  const { data: connectionsData } = useSWR("/api/providers", jsonFetcher);
  const { data: nodesData } = useSWR("/api/provider-nodes", jsonFetcher);
  const providers = buildConnectedProviders(
    connectionsData as Parameters<typeof buildConnectedProviders>[0],
    nodesData as Parameters<typeof buildConnectedProviders>[1],
  );

  const { data: statsData, isLoading, isValidating } = useSWR<Record<string, unknown>>(`/api/usage/stats?period=${period}`, jsonFetcher);
  const loading = isLoading;
  const fetching = isValidating && !isLoading;

  useEffect(() => {
    if (statsData) {
      hasLoadedStats.current = true;
      setStats((prev) => ({ ...prev, ...statsData }));
    }
  }, [statsData]);

  useEffect(() => {
    const es = new EventSource("/api/usage/stream");
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setStats((prev) => prev ? { ...prev, activeRequests: data.activeRequests, recentRequests: data.recentRequests, errorProvider: data.errorProvider, pending: data.pending } : prev);
      } catch (err) { console.error("[SSE CLIENT] parse error:", err); }
    };
    return () => es.close();
  }, []);

  const toggleSort = useCallback((_tableType: string, field: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("sortBy") === field) params.set("sortOrder", params.get("sortOrder") === "asc" ? "desc" : "asc");
    else { params.set("sortBy", field); params.set("sortOrder", "asc"); }
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  return { stats, loading, fetching, providers, sortBy, sortOrder, toggleSort };
}

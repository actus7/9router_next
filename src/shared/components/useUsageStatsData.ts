"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { fetchConnectedProviders } from "./usageStatsProviders";

export function useUsageStatsData(period: string) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sortBy = searchParams.get("sortBy") || "rawModel";
  const sortOrder = searchParams.get("sortOrder") || "asc";
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [providers, setProviders] = useState<{ provider: string; name: string; nodeName?: string }[]>([]);
  const isInitialLoad = useRef(true);
  const hasLoadedStats = useRef(false);

  useEffect(() => { fetchConnectedProviders().then(setProviders).catch(() => {}); }, []);

  useEffect(() => {
    if (isInitialLoad.current) { isInitialLoad.current = false; setLoading(true); } else { setFetching(true); }
    fetch(`/api/usage/stats?period=${period}`).then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) { hasLoadedStats.current = true; setStats((prev) => ({ ...prev, ...data })); } })
      .catch(() => {}).finally(() => { setLoading(false); setFetching(false); });
  }, [period]);

  useEffect(() => {
    const es = new EventSource("/api/usage/stream");
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setStats((prev) => prev ? { ...prev, activeRequests: data.activeRequests, recentRequests: data.recentRequests, errorProvider: data.errorProvider, pending: data.pending } : prev);
        if (hasLoadedStats.current) setLoading(false);
      } catch (err) { console.error("[SSE CLIENT] parse error:", err); }
    };
    es.onerror = () => setLoading(false);
    return () => es.close();
  }, []);

  const toggleSort = useCallback((tableType: string, field: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("sortBy") === field) params.set("sortOrder", params.get("sortOrder") === "asc" ? "desc" : "asc");
    else { params.set("sortBy", field); params.set("sortOrder", "asc"); }
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  return { stats, loading, fetching, providers, sortBy, sortOrder, toggleSort };
}

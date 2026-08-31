"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { FREE_PROVIDERS, AI_PROVIDERS } from "@/shared/constants/providers";

function isLLMProvider(id: string): boolean {
  const p = AI_PROVIDERS[id as keyof typeof AI_PROVIDERS] as Record<string, unknown> | undefined;
  if (!p?.serviceKinds) return true;
  return (p.serviceKinds as string[]).includes("llm");
}

export function useUsageStatsData(period: string) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sortBy = searchParams.get("sortBy") || "rawModel";
  const sortOrder = searchParams.get("sortOrder") || "asc";

  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [fetching, setFetching] = useState<boolean>(false);
  const [providers, setProviders] = useState<{ provider: string; name: string; nodeName?: string }[]>([]);
  const isInitialLoad = useRef<boolean>(true);
  const hasLoadedStats = useRef<boolean>(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/providers").then((r) => r.ok ? r.json() : null),
      fetch("/api/provider-nodes").then((r) => r.ok ? r.json() : null),
    ])
      .then(([d, nodesData]) => {
        const nodeNameMap: Record<string, string> = {};
        for (const node of (nodesData?.nodes || [])) {
          nodeNameMap[node.id] = node.name;
        }
        const seen = new Set<string>();
        const unique = (d?.connections || []).filter((c: { isActive?: boolean; provider: string }) => {
          if (c.isActive === false) return false;
          if (!isLLMProvider(c.provider)) return false;
          if (seen.has(c.provider)) return false;
          seen.add(c.provider);
          return true;
        }).map((c: { provider: string; name?: string }) => ({
          ...c,
          nodeName: nodeNameMap[c.provider] || undefined,
        }));
        const noAuthProviders = Object.values(FREE_PROVIDERS as Record<string, { id: string; name: string; noAuth?: boolean; hidden?: boolean }>)
          .filter((p) => p.noAuth && !p.hidden && !seen.has(p.id) && isLLMProvider(p.id))
          .map((p) => ({ provider: p.id, name: p.name }));
        setProviders([...unique, ...noAuthProviders]);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isInitialLoad.current) {
      isInitialLoad.current = false;
      setLoading(true);
    } else {
      setFetching(true);
    }
    fetch(`/api/usage/stats?period=${period}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          hasLoadedStats.current = true;
          setStats((prev) => ({ ...prev, ...data }));
        }
      })
      .catch(() => {})
      .finally(() => { setLoading(false); setFetching(false); });
  }, [period]);

  useEffect(() => {
    const es = new EventSource("/api/usage/stream");
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setStats((prev) => {
          if (!prev) return prev;
          return { ...prev, activeRequests: data.activeRequests, recentRequests: data.recentRequests, errorProvider: data.errorProvider, pending: data.pending };
        });
        if (hasLoadedStats.current) setLoading(false);
      } catch (err) { console.error("[SSE CLIENT] parse error:", err); }
    };
    es.onerror = () => setLoading(false);
    return () => es.close();
  }, []);

  const toggleSort = useCallback((tableType: string, field: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("sortBy") === field) {
      params.set("sortOrder", params.get("sortOrder") === "asc" ? "desc" : "asc");
    } else {
      params.set("sortBy", field);
      params.set("sortOrder", "asc");
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  return { stats, loading, fetching, providers, sortBy, sortOrder, toggleSort };
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { useSearchParams, useRouter } from "next/navigation";
import { jsonFetcher } from "@/shared/hooks/jsonFetcher";
import { buildConnectedProviders } from "./usageStatsProviders";

export function useUsageStatsData(period: string) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sortBy = searchParams.get("sortBy") || "rawModel";
  const sortOrder = searchParams.get("sortOrder") || "asc";
  const { mutate } = useSWRConfig();
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);

  const { data: connectionsData } = useSWR("/api/providers", jsonFetcher);
  const { data: nodesData } = useSWR("/api/provider-nodes", jsonFetcher);
  // Memoised: a fresh array every render defeated the useMemo in
  // ProviderTopology, so the whole graph relaid out on every SSE tick.
  const providers = useMemo(() => {
    return buildConnectedProviders(
      connectionsData as Parameters<typeof buildConnectedProviders>[0],
      nodesData as Parameters<typeof buildConnectedProviders>[1],
    );
  }, [connectionsData, nodesData]);

  const { data: statsData, isLoading, isValidating } = useSWR<Record<string, unknown>>(`/api/usage/stats?period=${period}`, jsonFetcher);
  // SWR flips isLoading off on resolve, but `stats` is only filled by the
  // effect below — which runs after the commit. For that one frame the
  // consumer saw "no stats, not loading" and rendered its failure message on
  // the first screen of the dashboard.
  const loading = isLoading || (statsData !== undefined && stats === null);
  const fetching = isValidating && !isLoading;

  useEffect(() => {
    if (statsData) setStats((prev) => ({ ...prev, ...statsData }));
  }, [statsData]);

  // Topo da lista de recentes na última mensagem do stream. `null` = ainda não
  // chegou nenhuma; a primeira só sincroniza, porque o SWR de montagem já leu
  // os mesmos dados.
  const lastRecordedAt = useRef<string | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/usage/stream");
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setStats((prev) => prev ? { ...prev, activeRequests: data.activeRequests, recentRequests: data.recentRequests, errorProvider: data.errorProvider, pending: data.pending } : prev);

        // O payload traz os totais do período "all" (`getUsageStats()` sem
        // argumento, no stream) e a tela está no período que o usuário
        // escolheu — por isso só os quatro campos acima vêm dele. Os cards, o
        // gráfico e a tabela se releem do endpoint do período certo, senão uma
        // chamada feita pela API só aparecia ali depois de recarregar a página.
        // Só quando uma linha nova foi gravada: o stream também acorda a cada
        // requisição que começa e termina, e aquilo não muda nenhum total.
        const recordedAt: string = data.recentRequests?.[0]?.timestamp ?? "";
        const isFirstMessage: boolean = lastRecordedAt.current === null;
        const hasNewRow: boolean = recordedAt !== lastRecordedAt.current;
        lastRecordedAt.current = recordedAt;
        if (!isFirstMessage && hasNewRow) {
          mutate((key: unknown) => typeof key === "string" && key.startsWith("/api/usage/"));
        }
      } catch (err) { console.error("[SSE CLIENT] parse error:", err); }
    };
    return () => es.close();
  }, [mutate]);

  const toggleSort = useCallback((_tableType: string, field: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("sortBy") === field) params.set("sortOrder", params.get("sortOrder") === "asc" ? "desc" : "asc");
    else { params.set("sortBy", field); params.set("sortOrder", "asc"); }
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  return { stats, loading, fetching, providers, sortBy, sortOrder, toggleSort };
}

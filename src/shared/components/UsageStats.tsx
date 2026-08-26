"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { FREE_PROVIDERS, AI_PROVIDERS } from "@/shared/constants/providers";

// Keep providers without serviceKinds (default LLM) or with "llm" in serviceKinds
function isLLMProvider(id: string): boolean {
  const p = AI_PROVIDERS[id as keyof typeof AI_PROVIDERS] as Record<string, unknown> | undefined;
  if (!p?.serviceKinds) return true;
  return (p.serviceKinds as string[]).includes("llm");
}
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import OverviewCards from "@/app/(dashboard)/dashboard/usage/components/OverviewCards";
import UsageTable, { fmt, fmtTime } from "@/app/(dashboard)/dashboard/usage/components/UsageTable";
import dynamic from "next/dynamic";
// Lazy-load: keeps @xyflow/react out of the shared bundle until topology renders
const ProviderTopology = dynamic(() => import("@/app/(dashboard)/dashboard/usage/components/ProviderTopology"), { ssr: false });
import UsageChart from "@/app/(dashboard)/dashboard/usage/components/UsageChart";

function timeAgo(timestamp: string | number | Date): string {
  const diff = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

interface TimeAgoProps {
  timestamp: string | number | Date;
}

// Auto-update time display every second without re-rendering parent
function TimeAgo({ timestamp }: TimeAgoProps) {
  const [, setTick] = useState<number>(0);
  
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  
  return <>{timeAgo(timestamp)}</>;
}

interface RecentRequest {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  timestamp?: string;
  status?: string;
  provider?: string;
}

interface RecentRequestsProps {
  requests?: RecentRequest[];
}

function RecentRequests({ requests = [] }: RecentRequestsProps) {
  return (
    <Card className="flex min-w-0 flex-col overflow-hidden" padding="sm" style={{ height: 480 }}>
      {/* Header */}
      <div className="px-1 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">Recent Requests</span>
      </div>

      {!requests.length ? (
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm">No requests yet.</div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <Table className="min-w-[300px] text-xs">
            <TableHeader className="sticky top-0 bg-bg z-10">
              <TableRow>
                <TableHead className="py-1.5 font-semibold text-text-muted w-2"></TableHead>
                <TableHead className="py-1.5 font-semibold text-text-muted">Model</TableHead>
                <TableHead className="py-1.5 text-right font-semibold text-text-muted">In / Out</TableHead>
                <TableHead className="py-1.5 text-right font-semibold text-text-muted">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r, i) => {
                const ok = !r.status || r.status === "ok" || r.status === "success";
                return (
                  <TableRow key={i} className="hover:bg-bg-subtle">
                    <TableCell className="py-1.5">
                      <span className={`block w-1.5 h-1.5 rounded-full ${ok ? "bg-success" : "bg-error"}`} />
                    </TableCell>
                    <TableCell className="py-1.5 font-mono truncate max-w-[120px]" title={r.model}>{r.model}</TableCell>
                    <TableCell className="py-1.5 text-right">
                      <span className="text-primary">{fmt(r.promptTokens || 0)}↑</span>
                      {" "}
                      <span className="text-success">{fmt(r.completionTokens || 0)}↓</span>
                    </TableCell>
                    <TableCell className="py-1.5 text-right text-text-muted"><TimeAgo timestamp={r.timestamp || ""} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

interface DataItem {
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  cost?: number;
  requests?: number;
  lastUsed?: string | null;
  rawModel?: string;
  provider?: string;
  accountName?: string;
  connectionId?: string;
  keyName?: string;
  endpoint?: string;
  [key: string]: unknown;
}

interface SortedItem extends DataItem {
  key: string;
  totalTokens: number;
  totalCost: number;
  inputCost: number;
  cachedCost: number;
  outputCost: number;
  pending: number;
}

function sortData(dataMap: Record<string, DataItem> | undefined, pendingMap: Record<string, number> = {}, sortBy: string, sortOrder: string): SortedItem[] {
  return Object.entries(dataMap || {})
    .map(([key, data]) => {
      const totalTokens = (data.promptTokens || 0) + (data.completionTokens || 0);
      const totalCost = data.cost || 0;
      const cachedTokens = data.cachedTokens || 0;
      const nonCachedInput = Math.max(0, (data.promptTokens || 0) - cachedTokens);
      const inputCost = totalTokens > 0 ? nonCachedInput * (totalCost / totalTokens) : 0;
      const cachedCost = totalTokens > 0 ? cachedTokens * (totalCost / totalTokens) : 0;
      const outputCost = totalTokens > 0 ? (data.completionTokens || 0) * (totalCost / totalTokens) : 0;
      return { ...data, key, totalTokens, totalCost, inputCost, cachedCost, outputCost, pending: pendingMap[key] || 0 };
    })
    .sort((a, b) => {
      let valA: unknown = (a as Record<string, unknown>)[sortBy];
      let valB: unknown = (b as Record<string, unknown>)[sortBy];
      if (typeof valA === "string") valA = valA.toLowerCase();
      if (typeof valB === "string") valB = valB.toLowerCase();
      if (valA == null && valB == null) return 0;
      if (valA == null) return sortOrder === "asc" ? 1 : -1;
      if (valB == null) return sortOrder === "asc" ? -1 : 1;
      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
}

interface GroupedData {
  groupKey: string;
  summary: {
    requests: number;
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    totalTokens: number;
    cost: number;
    inputCost: number;
    cachedCost: number;
    outputCost: number;
    lastUsed: string | null;
    pending: number;
  };
  items: SortedItem[];
}

function getGroupKey(item: SortedItem, keyField: string): string {
  switch (keyField) {
    case "rawModel": return item.rawModel || "Unknown Model";
    case "accountName": return item.accountName || `Account ${item.connectionId?.slice(0, 8)}...` || "Unknown Account";
    case "keyName": return item.keyName || "Unknown Key";
    case "endpoint": return item.endpoint || "Unknown Endpoint";
    default: return (item[keyField] as string) || "Unknown";
  }
}

function groupDataByKey(data: SortedItem[], keyField: string): GroupedData[] {
  if (!Array.isArray(data)) return [];
  const groups: Record<string, GroupedData> = {};
  data.forEach((item) => {
    const gk = getGroupKey(item, keyField);
    if (!groups[gk]) {
      groups[gk] = {
        groupKey: gk,
        summary: { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, totalTokens: 0, cost: 0, inputCost: 0, cachedCost: 0, outputCost: 0, lastUsed: null, pending: 0 },
        items: [],
      };
    }
    const s = groups[gk].summary;
    s.requests += item.requests || 0;
    s.promptTokens += item.promptTokens || 0;
    s.completionTokens += item.completionTokens || 0;
    s.cachedTokens += item.cachedTokens || 0;
    s.totalTokens += item.totalTokens || 0;
    s.cost += item.cost || 0;
    s.inputCost += item.inputCost || 0;
    s.cachedCost += item.cachedCost || 0;
    s.outputCost += item.outputCost || 0;
    s.pending += item.pending || 0;
    if (item.lastUsed && (!s.lastUsed || new Date(item.lastUsed) > new Date(s.lastUsed))) {
      s.lastUsed = item.lastUsed;
    }
    groups[gk].items.push(item);
  });
  return Object.values(groups);
}

const MODEL_COLUMNS = [
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" as const },
  { field: "lastUsed", label: "Last Used", align: "right" as const },
];

const ACCOUNT_COLUMNS = [
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "accountName", label: "Account" },
  { field: "requests", label: "Requests", align: "right" as const },
  { field: "lastUsed", label: "Last Used", align: "right" as const },
];

const API_KEY_COLUMNS = [
  { field: "keyName", label: "API Key Name" },
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" as const },
  { field: "lastUsed", label: "Last Used", align: "right" as const },
];

const ENDPOINT_COLUMNS = [
  { field: "endpoint", label: "Endpoint" },
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" as const },
  { field: "lastUsed", label: "Last Used", align: "right" as const },
];

const TABLE_OPTIONS = [
  { value: "model", label: "Usage by Model" },
  { value: "account", label: "Usage by Account" },
  { value: "apiKey", label: "Usage by API Key" },
  { value: "endpoint", label: "Usage by Endpoint" },
];

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
];

interface UsageStatsProps {
  period?: string;
  setPeriod?: (period: string) => void;
  hidePeriodSelector?: boolean;
}

export default function UsageStats({ period: periodProp, setPeriod: setPeriodProp, hidePeriodSelector = false }: UsageStatsProps = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const sortBy = searchParams.get("sortBy") || "rawModel";
  const sortOrder = searchParams.get("sortOrder") || "asc";

  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [fetching, setFetching] = useState<boolean>(false);
  const [tableView, setTableView] = useState<string>("model");
  const [viewMode, setViewMode] = useState<string>("costs");
  const [providers, setProviders] = useState<{ provider: string; name: string; nodeName?: string }[]>([]);
  const [periodLocal, setPeriodLocal] = useState<string>("today");
  const isInitialLoad = useRef<boolean>(true);
  const hasLoadedStats = useRef<boolean>(false);
  const period = periodProp ?? periodLocal;
  const setPeriod = setPeriodProp ?? setPeriodLocal;

  // Fetch connected providers once, deduplicate by provider type
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
        const noAuthProviders = Object.values(FREE_PROVIDERS as Record<string, { id: string; name: string; noAuth?: boolean }>)
          .filter((p) => p.noAuth && !seen.has(p.id) && isLLMProvider(p.id))
          .map((p) => ({ provider: p.id, name: p.name }));
        setProviders([...unique, ...noAuthProviders]);
      })
      .catch(() => {});
  }, []);

  // Fetch filtered stats via REST when period changes
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
      .finally(() => {
        setLoading(false);
        setFetching(false);
      });
  }, [period]);

  // SSE connection - real-time updates for activeRequests + recentRequests only
  useEffect(() => {
    const es = new EventSource("/api/usage/stream");

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setStats((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            activeRequests: data.activeRequests,
            recentRequests: data.recentRequests,
            errorProvider: data.errorProvider,
            pending: data.pending,
          };
        });
        if (hasLoadedStats.current) setLoading(false);
      } catch (err) {
        console.error("[SSE CLIENT] parse error:", err);
      }
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

  // Compute active table data
  const activeTableConfig = useMemo(() => {
    if (!stats) return null;
    switch (tableView) {
      case "model": {
        const pendingMap = (stats.pending as Record<string, Record<string, number>>)?.byModel || {};
        return {
          columns: MODEL_COLUMNS,
          groupedData: groupDataByKey(sortData(stats.byModel as Record<string, DataItem>, pendingMap, sortBy, sortOrder), "rawModel"),
          storageKey: "usage-stats:expanded-models",
          emptyMessage: "No usage recorded yet.",
          renderSummaryCells: (group: GroupedData) => (
            <>
              <TableCell className="px-6 py-3 text-text-muted">—</TableCell>
              <TableCell className="px-6 py-3 text-right">{fmt(group.summary.requests)}</TableCell>
              <TableCell className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(group.summary.lastUsed)}</TableCell>
            </>
          ),
          renderDetailCells: (item: SortedItem) => (
            <>
              <TableCell className={`px-6 py-3 font-medium transition-colors ${item.pending > 0 ? "text-primary" : ""}`}>{item.rawModel}</TableCell>
              <TableCell className="px-6 py-3"><Badge variant={item.pending > 0 ? "default" : "secondary"} className="h-auto px-2 py-0.5 text-[10px]">{item.provider}</Badge></TableCell>
              <TableCell className="px-6 py-3 text-right">{fmt(item.requests || 0)}</TableCell>
              <TableCell className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(item.lastUsed)}</TableCell>
            </>
          ),
        };
      }
      case "account": {
        const pendingMap: Record<string, number> = {};
        if ((stats?.pending as Record<string, Record<string, unknown>>)?.byAccount) {
          Object.entries((stats.byAccount as Record<string, DataItem>) || {}).forEach(([accountKey, data]) => {
            const connPending = ((stats.pending as Record<string, Record<string, Record<string, number>>>).byAccount)[data.connectionId || ""];
            if (connPending) {
              const modelKey = data.provider ? `${data.rawModel} (${data.provider})` : data.rawModel || "";
              pendingMap[accountKey] = connPending[modelKey] || 0;
            }
          });
        }
        return {
          columns: ACCOUNT_COLUMNS,
          groupedData: groupDataByKey(sortData(stats.byAccount as Record<string, DataItem>, pendingMap, sortBy, sortOrder), "accountName"),
          storageKey: "usage-stats:expanded-accounts",
          emptyMessage: "No account-specific usage recorded yet.",
          renderSummaryCells: (group: GroupedData) => (
            <>
              <TableCell className="px-6 py-3 text-text-muted">—</TableCell>
              <TableCell className="px-6 py-3 text-text-muted">—</TableCell>
              <TableCell className="px-6 py-3 text-right">{fmt(group.summary.requests)}</TableCell>
              <TableCell className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(group.summary.lastUsed)}</TableCell>
            </>
          ),
          renderDetailCells: (item: SortedItem) => (
            <>
              <TableCell className={`px-6 py-3 font-medium transition-colors ${item.pending > 0 ? "text-primary" : ""}`}>{item.accountName || `Account ${item.connectionId?.slice(0, 8)}...`}</TableCell>
              <TableCell className={`px-6 py-3 font-medium transition-colors ${item.pending > 0 ? "text-primary" : ""}`}>{item.rawModel}</TableCell>
              <TableCell className="px-6 py-3"><Badge variant={item.pending > 0 ? "default" : "secondary"} className="h-auto px-2 py-0.5 text-[10px]">{item.provider}</Badge></TableCell>
              <TableCell className="px-6 py-3 text-right">{fmt(item.requests || 0)}</TableCell>
              <TableCell className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(item.lastUsed)}</TableCell>
            </>
          ),
        };
      }
      case "apiKey": {
        return {
          columns: API_KEY_COLUMNS,
          groupedData: groupDataByKey(sortData(stats.byApiKey as Record<string, DataItem>, {}, sortBy, sortOrder), "keyName"),
          storageKey: "usage-stats:expanded-apikeys",
          emptyMessage: "No API key usage recorded yet.",
          renderSummaryCells: (group: GroupedData) => (
            <>
              <TableCell className="px-6 py-3 text-text-muted">—</TableCell>
              <TableCell className="px-6 py-3 text-text-muted">—</TableCell>
              <TableCell className="px-6 py-3 text-right">{fmt(group.summary.requests)}</TableCell>
              <TableCell className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(group.summary.lastUsed)}</TableCell>
            </>
          ),
          renderDetailCells: (item: SortedItem) => (
            <>
              <TableCell className="px-6 py-3 font-medium">{item.keyName}</TableCell>
              <TableCell className="px-6 py-3">{item.rawModel}</TableCell>
              <TableCell className="px-6 py-3"><Badge variant="secondary" className="h-auto px-2 py-0.5 text-[10px]">{item.provider}</Badge></TableCell>
              <TableCell className="px-6 py-3 text-right">{fmt(item.requests || 0)}</TableCell>
              <TableCell className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(item.lastUsed)}</TableCell>
            </>
          ),
        };
      }
      case "endpoint":
      default: {
        return {
          columns: ENDPOINT_COLUMNS,
          groupedData: groupDataByKey(sortData(stats.byEndpoint as Record<string, DataItem>, {}, sortBy, sortOrder), "endpoint"),
          storageKey: "usage-stats:expanded-endpoints",
          emptyMessage: "No endpoint usage recorded yet.",
          renderSummaryCells: (group: GroupedData) => (
            <>
              <TableCell className="px-6 py-3 text-text-muted">—</TableCell>
              <TableCell className="px-6 py-3 text-text-muted">—</TableCell>
              <TableCell className="px-6 py-3 text-right">{fmt(group.summary.requests)}</TableCell>
              <TableCell className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(group.summary.lastUsed)}</TableCell>
            </>
          ),
          renderDetailCells: (item: SortedItem) => (
            <>
              <TableCell className="px-6 py-3 font-medium font-mono text-sm">{item.endpoint}</TableCell>
              <TableCell className="px-6 py-3">{item.rawModel}</TableCell>
              <TableCell className="px-6 py-3"><Badge variant="secondary" className="h-auto px-2 py-0.5 text-[10px]">{item.provider}</Badge></TableCell>
              <TableCell className="px-6 py-3 text-right">{fmt(item.requests || 0)}</TableCell>
              <TableCell className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(item.lastUsed)}</TableCell>
            </>
          ),
        };
      }
    }
  }, [stats, tableView, sortBy, sortOrder]);

  if (!stats && !loading) return <div className="text-text-muted">Failed to load usage statistics.</div>;

  const spinner = (
    <div className="flex items-center justify-center py-12 text-text-muted">
      <span className="material-symbols-outlined text-[32px] animate-spin">progress_activity</span>
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Period selector (hidden when controlled by parent) */}
      {!hidePeriodSelector && (
        <div className="flex w-full items-center gap-2 sm:w-auto sm:self-end">
          <div className="grid flex-1 grid-cols-5 items-center gap-1 rounded-lg border border-border bg-bg-subtle p-1 sm:flex sm:flex-none">
            {PERIODS.map((p) => (
              <Button
                key={p.value}
                variant={period === p.value ? "default" : "ghost"}
                size="sm"
                onClick={() => setPeriod(p.value)}
                disabled={fetching}
                className="rounded-md px-3 py-1 text-sm font-medium"
              >
                {p.label}
              </Button>
            ))}
          </div>
          {fetching && (
            <span className="material-symbols-outlined text-[16px] text-text-muted animate-spin">progress_activity</span>
          )}
        </div>
      )}

      {/* Overview cards */}
      {loading ? spinner : <OverviewCards stats={stats as unknown as { totalRequests?: number; totalPromptTokens?: number; totalCachedTokens?: number; totalCompletionTokens?: number; totalCost?: number }} />}

      {/* Provider topology + Recent Requests */}
      {loading ? spinner : (
        <div className="grid min-w-0 grid-cols-1 items-stretch gap-2 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <ProviderTopology
            providers={providers}
            activeRequests={(stats?.activeRequests as Array<{ provider?: string; model?: string; account?: string }>) || []}
            lastProvider={((stats?.recentRequests as RecentRequest[])?.[0]?.provider) || ""}
            errorProvider={(stats?.errorProvider as string) || ""}
          />
          <RecentRequests requests={(stats?.recentRequests as RecentRequest[]) || []} />
        </div>
      )}

      {/* Token / Cost chart - sync period */}
      {loading ? spinner : <UsageChart period={period} />}

      {/* Table with dropdown selector */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Select value={tableView} onValueChange={setTableView}>
            <SelectTrigger className="w-full sm:w-auto">
              <SelectValue placeholder="Select view" />
            </SelectTrigger>
            <SelectContent>
              {TABLE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 items-center gap-1 rounded-lg border border-border bg-bg-subtle p-1 sm:flex">
            <Button
              variant={viewMode === "costs" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("costs")}
              className="px-3 py-1 rounded-md text-sm font-medium"
            >
              Costs
            </Button>
            <Button
              variant={viewMode === "tokens" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("tokens")}
              className="px-3 py-1 rounded-md text-sm font-medium"
            >
              Tokens
            </Button>
          </div>
        </div>
        {loading ? spinner : activeTableConfig && (
          <UsageTable
            title=""
            columns={activeTableConfig.columns}
            groupedData={activeTableConfig.groupedData}
            tableType={tableView}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onToggleSort={toggleSort}
            viewMode={viewMode}
            storageKey={activeTableConfig.storageKey}
            renderSummaryCells={activeTableConfig.renderSummaryCells as (group: { groupKey: string; summary: Record<string, unknown>; items: Array<Record<string, unknown> & { key: string }> }) => React.ReactNode}
            renderDetailCells={activeTableConfig.renderDetailCells as (item: Record<string, unknown>) => React.ReactNode}
            emptyMessage={activeTableConfig.emptyMessage}
          />
        )}
      </div>
    </div>
  );
}

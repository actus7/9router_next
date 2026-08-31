"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Button from "@/shared/components/Button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import OverviewCards from "@/app/(dashboard)/dashboard/usage/components/OverviewCards";
import UsageTable, { fmt } from "@/app/(dashboard)/dashboard/usage/components/UsageTable";
import dynamic from "next/dynamic";
const ProviderTopology = dynamic(() => import("@/app/(dashboard)/dashboard/usage/components/ProviderTopology"), { ssr: false });
import UsageChart from "@/app/(dashboard)/dashboard/usage/components/UsageChart";
import { Loader2 } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { buildTableConfig, TABLE_OPTIONS, PERIODS } from "./usageStatsHelpers";
import { useUsageStatsData } from "./useUsageStatsData";

interface RecentRequest {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  timestamp?: string;
  status?: string;
  provider?: string;
}

function timeAgo(timestamp: string | number | Date): string {
  const diff = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
  const ago = translate("ago") ?? "ago";
  if (diff < 60) return diff + "s " + ago;
  if (diff < 3600) return Math.floor(diff / 60) + "m " + ago;
  if (diff < 86400) return Math.floor(diff / 3600) + "h " + ago;
  return Math.floor(diff / 86400) + "d " + ago;
}

function TimeAgo({ timestamp }: { timestamp: string | number | Date }) {
  const [, setTick] = useState<number>(0);
  useEffect(() => { const timer = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(timer); }, []);
  return <>{timeAgo(timestamp)}</>;
}

function RecentRequests({ requests = [] }: { requests?: RecentRequest[] }) {
  return (
    <Card className="flex min-w-0 flex-col overflow-hidden p-4" style={{ height: 480 }}>
      <div className="px-1 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">{translate("Recent Requests")}</span>
      </div>
      {!requests.length ? (
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm">{translate("No requests yet.")}</div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <Table className="min-w-[300px] text-xs">
            <TableHeader className="sticky top-0 bg-bg z-10">
              <TableRow>
                <TableHead className="py-1.5 font-semibold text-text-muted w-2"></TableHead>
                <TableHead className="py-1.5 font-semibold text-text-muted">{translate("Model")}</TableHead>
                <TableHead className="py-1.5 text-right font-semibold text-text-muted">{translate("In / Out")}</TableHead>
                <TableHead className="py-1.5 text-right font-semibold text-text-muted">{translate("When")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r, i) => {
                const ok = !r.status || r.status === "ok" || r.status === "success";
                return (
                  <TableRow key={i} className="hover:bg-bg-subtle">
                    <TableCell className="py-1.5"><span className={`block w-1.5 h-1.5 rounded-full ${ok ? "bg-success" : "bg-error"}`} /></TableCell>
                    <TableCell className="py-1.5 font-mono truncate max-w-[120px]" title={r.model}>{r.model}</TableCell>
                    <TableCell className="py-1.5 text-right"><span className="text-primary">{fmt(r.promptTokens || 0)}↑</span>{" "}<span className="text-success">{fmt(r.completionTokens || 0)}↓</span></TableCell>
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

interface UsageStatsProps {
  period?: string;
  setPeriod?: (period: string) => void;
  hidePeriodSelector?: boolean;
}

export default function UsageStats({ period: periodProp, setPeriod: setPeriodProp, hidePeriodSelector = false }: UsageStatsProps = {}) {
  const [periodLocal, setPeriodLocal] = useState<string>("today");
  const [tableView, setTableView] = useState<string>("model");
  const [viewMode, setViewMode] = useState<string>("costs");
  const period = periodProp ?? periodLocal;
  const setPeriod = setPeriodProp ?? setPeriodLocal;

  const { stats, loading, fetching, providers, sortBy, sortOrder, toggleSort } = useUsageStatsData(period);

  const activeTableConfig = useMemo(() => {
    if (!stats) return null;
    return buildTableConfig(stats, tableView, sortBy, sortOrder);
  }, [stats, tableView, sortBy, sortOrder]);

  if (!stats && !loading) return <div className="text-text-muted">{translate("Failed to load usage statistics.")}</div>;

  const spinner = (
    <div className="flex items-center justify-center py-12 text-text-muted">
      <Loader2 className="size-8" />
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {!hidePeriodSelector && (
        <div className="flex w-full items-center gap-2 sm:w-auto sm:self-end">
          <div className="grid flex-1 grid-cols-5 items-center gap-1 rounded-lg border border-border bg-bg-subtle p-1 sm:flex sm:flex-none">
            {PERIODS.map((p) => (
              <Button key={p.value} variant={period === p.value ? "default" : "ghost"} size="sm" onClick={() => setPeriod(p.value)} disabled={fetching} className="rounded-md px-3 py-1 text-sm font-medium">
                {p.label}
              </Button>
            ))}
          </div>
          {fetching && <Loader2 className="size-4" />}
        </div>
      )}

      {loading ? spinner : <OverviewCards stats={stats as unknown as { totalRequests?: number; totalPromptTokens?: number; totalCachedTokens?: number; totalCompletionTokens?: number; totalCost?: number }} />}

      {loading ? spinner : (
        <div className="flex flex-col gap-2">
          <div>
            <h2 className="text-sm font-semibold text-text-main">{translate("Where your requests are going") || "Where your requests are going"}</h2>
            <p className="text-xs text-text-muted">{translate("Active routes per provider now, and the latest recorded calls.") || "Active routes per provider now, and the latest recorded calls."}</p>
          </div>
          <div className="grid min-w-0 grid-cols-1 items-stretch gap-2 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
            <ProviderTopology providers={providers} activeRequests={(stats?.activeRequests as Array<{ provider?: string; model?: string; account?: string }>) || []} lastProvider={((stats?.recentRequests as RecentRequest[])?.[0]?.provider) || ""} errorProvider={(stats?.errorProvider as string) || ""} />
            <RecentRequests requests={(stats?.recentRequests as RecentRequest[]) || []} />
          </div>
        </div>
      )}

      {loading ? spinner : (
        <div className="flex flex-col gap-2">
          <div>
            <h2 className="text-sm font-semibold text-text-main">{translate("Trend over time") || "Trend over time"}</h2>
            <p className="text-xs text-text-muted">{translate("Token volume and estimated cost, in the period selected above.") || "Token volume and estimated cost, in the period selected above."}</p>
          </div>
          <UsageChart period={period} />
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text-main">{translate("Breakdown") || "Breakdown"}</h2>
          <p className="text-xs text-text-muted">{translate("Group by model, account, API key or endpoint, and switch between cost and tokens.") || "Group by model, account, API key or endpoint, and switch between cost and tokens."}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Select value={tableView} onValueChange={(value) => setTableView(value ?? "model")}>
            <SelectTrigger className="w-full sm:w-auto"><SelectValue placeholder={translate("Select view") ?? "Select view"} /></SelectTrigger>
            <SelectContent>{TABLE_OPTIONS.map((opt) => (<SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>))}</SelectContent>
          </Select>
          <div className="grid grid-cols-2 items-center gap-1 rounded-lg border border-border bg-bg-subtle p-1 sm:flex">
            <Button variant={viewMode === "costs" ? "default" : "ghost"} size="sm" onClick={() => setViewMode("costs")} className="px-3 py-1 rounded-md text-sm font-medium">{translate("Costs")}</Button>
            <Button variant={viewMode === "tokens" ? "default" : "ghost"} size="sm" onClick={() => setViewMode("tokens")} className="px-3 py-1 rounded-md text-sm font-medium">{translate("Tokens")}</Button>
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

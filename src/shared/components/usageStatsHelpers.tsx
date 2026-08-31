"use client";

import { Badge } from "@/components/ui/badge";
import { TableCell } from "@/components/ui/table";
import { fmt, fmtTime } from "@/app/(dashboard)/dashboard/usage/components/UsageTable";
import { translate } from "@/i18n/runtime";

export interface DataItem {
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

export interface SortedItem extends DataItem {
  key: string;
  totalTokens: number;
  totalCost: number;
  inputCost: number;
  cachedCost: number;
  outputCost: number;
  pending: number;
}

export interface GroupedData {
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

export function sortData(
  dataMap: Record<string, DataItem> | undefined,
  pendingMap: Record<string, number> = {},
  sortBy: string,
  sortOrder: string,
): SortedItem[] {
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

export function getGroupKey(item: SortedItem, keyField: string): string {
  switch (keyField) {
    case "rawModel": return item.rawModel || (translate("Unknown Model") ?? "Unknown Model");
    case "accountName": return item.accountName || (translate("Account") + " " + (item.connectionId?.slice(0, 8) ?? "") + "...") || (translate("Unknown Account") ?? "Unknown Account");
    case "keyName": return item.keyName || (translate("Unknown Key") ?? "Unknown Key");
    case "endpoint": return item.endpoint || (translate("Unknown Endpoint") ?? "Unknown Endpoint");
    default: return (item[keyField] as string) || (translate("Unknown") ?? "Unknown");
  }
}

export function groupDataByKey(data: SortedItem[], keyField: string): GroupedData[] {
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

export const MODEL_COLUMNS = [
  { field: "rawModel", label: translate("Model") ?? "Model" },
  { field: "provider", label: translate("Provider") ?? "Provider" },
  { field: "requests", label: translate("Requests") ?? "Requests", align: "right" as const },
  { field: "lastUsed", label: translate("Last Used") ?? "Last Used", align: "right" as const },
];

export const ACCOUNT_COLUMNS = [
  { field: "rawModel", label: translate("Model") ?? "Model" },
  { field: "provider", label: translate("Provider") ?? "Provider" },
  { field: "accountName", label: translate("Account") ?? "Account" },
  { field: "requests", label: translate("Requests") ?? "Requests", align: "right" as const },
  { field: "lastUsed", label: translate("Last Used") ?? "Last Used", align: "right" as const },
];

export const API_KEY_COLUMNS = [
  { field: "keyName", label: translate("API Key Name") ?? "API Key Name" },
  { field: "rawModel", label: translate("Model") ?? "Model" },
  { field: "provider", label: translate("Provider") ?? "Provider" },
  { field: "requests", label: translate("Requests") ?? "Requests", align: "right" as const },
  { field: "lastUsed", label: translate("Last Used") ?? "Last Used", align: "right" as const },
];

export const ENDPOINT_COLUMNS = [
  { field: "endpoint", label: translate("Endpoint") ?? "Endpoint" },
  { field: "rawModel", label: translate("Model") ?? "Model" },
  { field: "provider", label: translate("Provider") ?? "Provider" },
  { field: "requests", label: translate("Requests") ?? "Requests", align: "right" as const },
  { field: "lastUsed", label: translate("Last Used") ?? "Last Used", align: "right" as const },
];

export const TABLE_OPTIONS = [
  { value: "model", label: translate("Usage by Model") ?? "Usage by Model" },
  { value: "account", label: translate("Usage by Account") ?? "Usage by Account" },
  { value: "apiKey", label: translate("Usage by API Key") ?? "Usage by API Key" },
  { value: "endpoint", label: translate("Usage by Endpoint") ?? "Usage by Endpoint" },
];

export const PERIODS = [
  { value: "today", label: translate("Today") ?? "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
];

function renderModelSummary(group: GroupedData) {
  return (
    <>
      <TableCell className="px-6 py-3 text-text-muted">—</TableCell>
      <TableCell className="px-6 py-3 text-right">{fmt(group.summary.requests)}</TableCell>
      <TableCell className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(group.summary.lastUsed)}</TableCell>
    </>
  );
}

function renderModelDetail(item: SortedItem) {
  return (
    <>
      <TableCell className={`px-6 py-3 font-medium transition-colors ${item.pending > 0 ? "text-primary" : ""}`}>{item.rawModel}</TableCell>
      <TableCell className="px-6 py-3"><Badge variant={item.pending > 0 ? "default" : "secondary"} className="h-auto px-2 py-0.5 text-[10px]">{item.provider}</Badge></TableCell>
      <TableCell className="px-6 py-3 text-right">{fmt(item.requests || 0)}</TableCell>
      <TableCell className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(item.lastUsed)}</TableCell>
    </>
  );
}

function renderAccountSummary(group: GroupedData) {
  return (
    <>
      <TableCell className="px-6 py-3 text-text-muted">—</TableCell>
      <TableCell className="px-6 py-3 text-text-muted">—</TableCell>
      <TableCell className="px-6 py-3 text-right">{fmt(group.summary.requests)}</TableCell>
      <TableCell className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(group.summary.lastUsed)}</TableCell>
    </>
  );
}

function renderAccountDetail(item: SortedItem) {
  return (
    <>
      <TableCell className={`px-6 py-3 font-medium transition-colors ${item.pending > 0 ? "text-primary" : ""}`}>{item.accountName || (translate("Account") + " " + (item.connectionId?.slice(0, 8) ?? "") + "...")}</TableCell>
      <TableCell className={`px-6 py-3 font-medium transition-colors ${item.pending > 0 ? "text-primary" : ""}`}>{item.rawModel}</TableCell>
      <TableCell className="px-6 py-3"><Badge variant={item.pending > 0 ? "default" : "secondary"} className="h-auto px-2 py-0.5 text-[10px]">{item.provider}</Badge></TableCell>
      <TableCell className="px-6 py-3 text-right">{fmt(item.requests || 0)}</TableCell>
      <TableCell className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(item.lastUsed)}</TableCell>
    </>
  );
}

function renderApiKeySummary(group: GroupedData) {
  return (
    <>
      <TableCell className="px-6 py-3 text-text-muted">—</TableCell>
      <TableCell className="px-6 py-3 text-text-muted">—</TableCell>
      <TableCell className="px-6 py-3 text-right">{fmt(group.summary.requests)}</TableCell>
      <TableCell className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(group.summary.lastUsed)}</TableCell>
    </>
  );
}

function renderApiKeyDetail(item: SortedItem) {
  return (
    <>
      <TableCell className="px-6 py-3 font-medium">{item.keyName}</TableCell>
      <TableCell className="px-6 py-3">{item.rawModel}</TableCell>
      <TableCell className="px-6 py-3"><Badge variant="secondary" className="h-auto px-2 py-0.5 text-[10px]">{item.provider}</Badge></TableCell>
      <TableCell className="px-6 py-3 text-right">{fmt(item.requests || 0)}</TableCell>
      <TableCell className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(item.lastUsed)}</TableCell>
    </>
  );
}

function renderEndpointSummary(group: GroupedData) {
  return (
    <>
      <TableCell className="px-6 py-3 text-text-muted">—</TableCell>
      <TableCell className="px-6 py-3 text-text-muted">—</TableCell>
      <TableCell className="px-6 py-3 text-right">{fmt(group.summary.requests)}</TableCell>
      <TableCell className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(group.summary.lastUsed)}</TableCell>
    </>
  );
}

function renderEndpointDetail(item: SortedItem) {
  return (
    <>
      <TableCell className="px-6 py-3 font-medium font-mono text-sm">{item.endpoint}</TableCell>
      <TableCell className="px-6 py-3">{item.rawModel}</TableCell>
      <TableCell className="px-6 py-3"><Badge variant="secondary" className="h-auto px-2 py-0.5 text-[10px]">{item.provider}</Badge></TableCell>
      <TableCell className="px-6 py-3 text-right">{fmt(item.requests || 0)}</TableCell>
      <TableCell className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(item.lastUsed)}</TableCell>
    </>
  );
}

export function buildTableConfig(stats: Record<string, unknown>, tableView: string, sortBy: string, sortOrder: string) {
  switch (tableView) {
    case "model": {
      const pendingMap = (stats.pending as Record<string, Record<string, number>>)?.byModel || {};
      return {
        columns: MODEL_COLUMNS,
        groupedData: groupDataByKey(sortData(stats.byModel as Record<string, DataItem>, pendingMap, sortBy, sortOrder), "rawModel"),
        storageKey: "usage-stats:expanded-models",
        emptyMessage: translate("No usage yet.") ?? "No usage yet.",
        renderSummaryCells: renderModelSummary,
        renderDetailCells: renderModelDetail,
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
        emptyMessage: translate("No account-specific usage recorded yet.") ?? "No account-specific usage recorded yet.",
        renderSummaryCells: renderAccountSummary,
        renderDetailCells: renderAccountDetail,
      };
    }
    case "apiKey":
      return {
        columns: API_KEY_COLUMNS,
        groupedData: groupDataByKey(sortData(stats.byApiKey as Record<string, DataItem>, {}, sortBy, sortOrder), "keyName"),
        storageKey: "usage-stats:expanded-apikeys",
        emptyMessage: translate("No API key usage recorded yet.") ?? "No API key usage recorded yet.",
        renderSummaryCells: renderApiKeySummary,
        renderDetailCells: renderApiKeyDetail,
      };
    case "endpoint":
    default:
      return {
        columns: ENDPOINT_COLUMNS,
        groupedData: groupDataByKey(sortData(stats.byEndpoint as Record<string, DataItem>, {}, sortBy, sortOrder), "endpoint"),
        storageKey: "usage-stats:expanded-endpoints",
        emptyMessage: translate("No endpoint usage recorded yet.") ?? "No endpoint usage recorded yet.",
        renderSummaryCells: renderEndpointSummary,
        renderDetailCells: renderEndpointDetail,
      };
  }
}

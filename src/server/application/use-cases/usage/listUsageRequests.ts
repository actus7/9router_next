import "server-only";

import {
  getUsageFilterOptions,
  listUsageRequests as fetchUsageRequestRows,
  USAGE_SUCCESS_STATUSES,
  type UsageRequestRow,
} from "@/lib/db/repos/usageRequestsRepo";
import type { RoutingAttemptSummary } from "@/shared/observability/routingTrace";
import { mapRequestDetailIds } from "@/lib/db/repos/requestDetailsRepo";

/** Windows the `range` query param accepts; anything else is a 400. */
export const USAGE_REQUEST_RANGES = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
  "365d": 365 * 24 * 60 * 60 * 1000,
} as const;

export type UsageRequestRange = keyof typeof USAGE_REQUEST_RANGES;
export type UsageRequestStatusLabel = "success" | "failed";

export function isUsageRequestRange(value: string): value is UsageRequestRange {
  return Object.prototype.hasOwnProperty.call(USAGE_REQUEST_RANGES, value);
}

/** Compact routing summary as stored in `usageHistory.meta.routing`. */
export interface UsageRequestRouting {
  attempts?: RoutingAttemptSummary[];
  requested: string;
  selected?: string;
  steps: number;
  switched?: number;
  failed?: number;
  combo?: string;
  tier?: string;
  truncated?: boolean;
}

export interface UsageRequestItem {
  id: number;
  timestamp: string;
  provider: string | null;
  model: string | null;
  connectionId: string | null;
  endpoint: string | null;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  statusLabel: UsageRequestStatusLabel;
  statusRaw: string;
  tokens: {
    cached_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
  routing: UsageRequestRouting | null;
  /** requestDetails id of the same request, when bodies were recorded. */
  detailId: string | null;
}

export interface ListUsageRequestsOptions {
  page?: number;
  pageSize?: number;
  status?: UsageRequestStatusLabel;
  model?: string;
  provider?: string;
  apiKey?: string;
  range?: UsageRequestRange;
  fallback?: boolean;
  hasFailed?: boolean;
  includeFilterOptions?: boolean;
}

export interface ListUsageRequestsResult {
  requests: UsageRequestItem[];
  pagination: { page: number; pageSize: number; totalItems: number };
  /** Only present when the caller asked for it (first load of the filters). */
  filterOptions?: { providers: string[]; models: string[]; apiKeys: Array<{ id: string; name: string | null }> };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * The stored status words that mean "settled fine", as the SQL filter spells
 * them: `saveRequestUsage` defaults to "ok" and the embeddings path writes
 * "success". Anything else is what the list labels "failed".
 */
function statusLabelOf(status: string | null): UsageRequestStatusLabel {
  return USAGE_SUCCESS_STATUSES.includes(status ?? "") ? "success" : "failed";
}

function routingOf(meta: Record<string, unknown>): UsageRequestRouting | null {
  const routing = meta.routing;
  if (!routing || typeof routing !== "object" || Array.isArray(routing)) return null;
  return routing as UsageRequestRouting;
}

function toItem(row: UsageRequestRow, detailIds: Map<number, string>): UsageRequestItem {
  const tokens = record(row.tokens);
  return {
    id: row.id,
    timestamp: row.timestamp,
    provider: row.provider,
    model: row.model,
    connectionId: row.connectionId,
    endpoint: row.endpoint,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    cost: row.cost,
    statusLabel: statusLabelOf(row.status),
    statusRaw: typeof row.status === "string" ? row.status : "",
    tokens: {
      cached_tokens: toCount(tokens.cached_tokens ?? tokens.cache_read_input_tokens),
      cache_read_input_tokens: toCount(tokens.cache_read_input_tokens ?? tokens.cached_tokens),
      cache_creation_input_tokens: toCount(tokens.cache_creation_input_tokens),
    },
    routing: routingOf(row.meta),
    detailId: detailIds.get(row.id) ?? null,
  };
}

/**
 * The always-on Requests list: one page of `usageHistory` (every request gets a
 * row) with the routing summary and the request-detail id each row links to.
 */
export async function listUsageRequests(options: ListUsageRequestsOptions = {}): Promise<ListUsageRequestsResult> {
  const page: number = Math.max(1, Math.floor(options.page ?? 1) || 1);
  const pageSize: number = Math.min(100, Math.max(1, Math.floor(options.pageSize ?? 20) || 20));
  const since: string | undefined = options.range
    ? new Date(Date.now() - USAGE_REQUEST_RANGES[options.range]).toISOString()
    : undefined;

  const { rows, totalItems } = await fetchUsageRequestRows({
    provider: options.provider || undefined,
    apiKey: options.apiKey || undefined,
    model: options.model || undefined,
    since,
    status: options.status,
    fallback: options.fallback === true,
    hasFailed: options.hasFailed === true,
    page,
    pageSize,
  });

  // Detail ids are best-effort: the link only exists for details written since
  // it landed, and `requestDetails` is opt-in and pruned. A lookup failure
  // degrades rows to `detailId: null` rather than failing the list.
  let detailIds: Map<number, string> = new Map();
  try {
    detailIds = await mapRequestDetailIds(rows.map((row) => row.id));
  } catch {
    detailIds = new Map();
  }

  const result: ListUsageRequestsResult = {
    requests: rows.map((row) => toItem(row, detailIds)),
    pagination: { page, pageSize, totalItems },
  };

  if (options.includeFilterOptions) {
    result.filterOptions = await getUsageFilterOptions();
  }

  return result;
}

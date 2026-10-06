/**
 * The always-on Requests list: `usageHistory` rows, one per request, with the
 * filters and pagination the Requests UI pages over. Split from `usageRepo`
 * because that file is at its size ceiling - same table, same tenant scoping,
 * and `saveRequestUsage` there is what answers the `usageId` these rows carry.
 */

import { getAdapter } from "../driver";
import { currentTenantId } from "../tenant";
import { parseJson } from "../helpers/jsonCol";
import { toPersistenceError } from "../errors";
import { MODELHUB_PROVIDER } from "@/shared/usage/requestFilters";

/**
 * Status values that read as "this request settled fine". Written by different
 * writers: `saveRequestUsage` defaults to "ok", the embeddings path writes
 * "success". Everything else is a failure the Requests list can filter on.
 */
export const USAGE_SUCCESS_STATUSES: readonly string[] = ["", "ok", "success"];

const USAGE_SUCCESS_SQL: string = USAGE_SUCCESS_STATUSES.map((s) => `'${s}'`).join(", ");

// The two routing-summary filters live in `meta.routing` (JSON), so they are
// SQL conditions rather than a post-filter: dropping rows after the LIMIT/OFFSET
// page was cut would break both pagination and the total count. Postgres-only,
// same as the rest of this adapter.
const ROUTING_META_SQL: string = "COALESCE(meta,'{}')::jsonb";
const USAGE_FALLBACK_SQL: string =
  `(COALESCE((${ROUTING_META_SQL} #>> '{routing,switched}')::numeric, 0) > 0` +
  ` OR ((${ROUTING_META_SQL} #>> '{routing,selected}') IS NOT NULL` +
  ` AND (${ROUTING_META_SQL} #>> '{routing,selected}') <> (${ROUTING_META_SQL} #>> '{routing,requested}')))`;
const USAGE_MODELHUB_SQL: string = `(${ROUTING_META_SQL} #>> '{routing,combo}') IS NOT NULL`;
const USAGE_HAS_FAILED_SQL: string =
  `COALESCE((${ROUTING_META_SQL} #>> '{routing,failed}')::numeric, 0) > 0`;

export interface UsageRequestsFilter {
  /** A provider id, or `MODELHUB_PROVIDER` for requests that went through a combo. */
  provider?: string;
  model?: string;
  /** `apiKeys.id` the request was made with. */
  apiKey?: string;
  /** ISO timestamp lower bound (the window behind `range`). */
  since?: string;
  status?: "success" | "failed";
  /** Only rows whose routing summary switched away from the requested model. */
  fallback?: boolean;
  /** Only rows whose routing summary recorded model-level failures. */
  hasFailed?: boolean;
  page: number;
  pageSize: number;
}

export interface UsageRequestRow {
  id: number;
  timestamp: string;
  provider: string | null;
  model: string | null;
  connectionId: string | null;
  endpoint: string | null;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  status: string | null;
  tokens: Record<string, unknown>;
  meta: Record<string, unknown>;
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toUsageRequestRow(r: Record<string, unknown>): UsageRequestRow {
  return {
    id: toNumber(r.id),
    timestamp: r.timestamp as string,
    provider: (r.provider as string) ?? null,
    model: (r.model as string) ?? null,
    connectionId: (r.connectionId as string) ?? null,
    endpoint: (r.endpoint as string) ?? null,
    promptTokens: toNumber(r.promptTokens),
    completionTokens: toNumber(r.completionTokens),
    cost: toNumber(r.cost),
    status: (r.status as string) ?? null,
    tokens: (parseJson(r.tokens, {}) ?? {}) as Record<string, unknown>,
    meta: (parseJson(r.meta, {}) ?? {}) as Record<string, unknown>,
  };
}

/**
 * One page of `usageHistory`, newest first, for the Requests list.
 *
 * Rows are addressed by the `id` of the always-written usage row (never
 * pruned), which is also the `usageId` the request-detail lookup takes.
 */
export async function listUsageRequests(filter: UsageRequestsFilter): Promise<{ rows: UsageRequestRow[]; totalItems: number }> {
  try {
    const db = await getAdapter();
    const conds: string[] = [];
    const params: unknown[] = [currentTenantId()];

    if (filter.provider === MODELHUB_PROVIDER) conds.push(USAGE_MODELHUB_SQL);
    else if (filter.provider) { conds.push("provider = ?"); params.push(filter.provider); }
    if (filter.apiKey) { conds.push("apiKey = ?"); params.push(filter.apiKey); }
    if (filter.model) { conds.push("model = ?"); params.push(filter.model); }
    if (filter.since) { conds.push("timestamp >= ?"); params.push(filter.since); }
    if (filter.status === "success") conds.push(`COALESCE(status, '') IN (${USAGE_SUCCESS_SQL})`);
    if (filter.status === "failed") conds.push(`COALESCE(status, '') NOT IN (${USAGE_SUCCESS_SQL})`);
    if (filter.fallback) conds.push(USAGE_FALLBACK_SQL);
    if (filter.hasFailed) conds.push(USAGE_HAS_FAILED_SQL);

    const where: string = conds.length ? `AND ${conds.join(" AND ")}` : "";
    const cntRow = await db.get(`SELECT COUNT(*) as c FROM usageHistory WHERE userId = ? ${where}`, params) as { c: number | string } | undefined;
    const totalItems: number = cntRow ? toNumber(cntRow.c) : 0;

    const page: number = Math.max(1, filter.page || 1);
    const pageSize: number = Math.min(100, Math.max(1, filter.pageSize || 20));
    const offset: number = (page - 1) * pageSize;

    const rows = await db.all(
      `SELECT id, timestamp, provider, model, connectionId, endpoint, promptTokens, completionTokens, cost, status, tokens, meta FROM usageHistory WHERE userId = ? ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    ) as Array<Record<string, unknown>>;

    return { rows: rows.map(toUsageRequestRow), totalItems };
  } catch (error) {
    throw toPersistenceError("usage.listRequests", error);
  }
}

/** Distinct providers/models of this account's rows, to populate the list filters. */
export async function getUsageFilterOptions(): Promise<{
  providers: string[];
  models: string[];
  apiKeys: Array<{ id: string; name: string | null }>;
}> {
  try {
    const db = await getAdapter();
    const userId: string = currentTenantId();
    const providers = await db.all(
      `SELECT DISTINCT provider FROM usageHistory WHERE userId = ? AND provider IS NOT NULL AND provider <> '' ORDER BY provider ASC`,
      [userId],
    ) as Array<{ provider: string }>;
    const models = await db.all(
      `SELECT DISTINCT model FROM usageHistory WHERE userId = ? AND model IS NOT NULL AND model <> '' ORDER BY model ASC`,
      [userId],
    ) as Array<{ model: string }>;
    // Keys the account has since deleted stay listed (name null): their rows remain.
    const apiKeys = await db.all(
      `SELECT DISTINCT u.apiKey AS id, k.name AS name
         FROM usageHistory u LEFT JOIN apiKeys k ON k.id = u.apiKey AND k.userId = u.userId
        WHERE u.userId = ? AND u.apiKey IS NOT NULL AND u.apiKey NOT IN ('', 'local-no-key')
        ORDER BY k.name ASC`,
      [userId],
    ) as Array<{ id: string; name: string | null }>;
    return {
      providers: providers.map((r) => r.provider).filter(Boolean),
      models: models.map((r) => r.model).filter(Boolean),
      apiKeys: apiKeys.map((r) => ({ id: r.id, name: r.name ?? null })),
    };
  } catch (error) {
    throw toPersistenceError("usage.filterOptions", error);
  }
}

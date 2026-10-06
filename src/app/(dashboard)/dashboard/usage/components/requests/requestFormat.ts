import type { RequestDetail } from "../types";
import type { RequestFilters, RequestRoutingInfo, RequestRow } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");

/** HH:MM:SS in local time — the scanning anchor of the list. */
export function formatClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Short local date (DD/MM), kept next to the clock in the same cell. */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

export interface CostCell {
  text: string;
  /** Full-precision value, shown on hover for sub-cent costs. */
  title?: string;
}

/** Cost cell: six decimals below one cent, two decimals above; null → "—". */
export function formatCostCell(cost: number | null | undefined): CostCell {
  if (cost === null || cost === undefined || Number.isNaN(cost)) return { text: "—" };
  if (Math.abs(cost) < 0.01) {
    return { text: `$${cost.toFixed(6)}`, title: `$${String(cost)}` };
  }
  return { text: `$${cost.toFixed(2)}` };
}

/** Total tokens of a row (prompt + completion). */
export function totalTokens(row: RequestRow): number | null {
  if (row.promptTokens === undefined && row.completionTokens === undefined) return null;
  return (row.promptTokens || 0) + (row.completionTokens || 0);
}

/** The visible model jump: null when the request stayed on its requested model. */
export function modelJump(routing: RequestRoutingInfo | null | undefined): { from: string; to: string } | null {
  const requested = routing?.requested || null;
  const selected = routing?.selected || null;
  if (requested && selected && requested !== selected) return { from: requested, to: selected };
  return null;
}

export function hasActiveFilters(filters: RequestFilters): boolean {
  return Boolean(
    filters.status || filters.model || filters.provider || filters.apiKey || filters.range || filters.fallback || filters.hasFailed,
  );
}

/** Query string for GET /api/usage/requests, per the fixed contract. */
export function buildRequestsQuery(filters: RequestFilters, page: number, pageSize: number): string {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    includeFilterOptions: "1",
  });
  if (filters.status) params.set("status", filters.status);
  if (filters.model) params.set("model", filters.model);
  if (filters.provider) params.set("provider", filters.provider);
  if (filters.apiKey) params.set("apiKey", filters.apiKey);
  if (filters.range) params.set("range", filters.range);
  if (filters.fallback) params.set("fallback", "true");
  if (filters.hasFailed) params.set("hasFailed", "true");
  return params.toString();
}

/**
 * The detail endpoint answers with one record when bodies were recorded; the
 * shape has drifted between a bare record, { detail } and { details: [...] },
 * so accept all three. Anything else means "no bodies" → fallback drawer.
 */
export function normalizeRequestDetail(data: unknown): RequestDetail | null {
  if (!data || typeof data !== "object") return null;
  const body = data as { detail?: unknown; details?: unknown[] };
  const candidate: unknown = Array.isArray(body.details)
    ? body.details[0]
    : body.detail !== undefined
      ? body.detail
      : data;
  if (!candidate || typeof candidate !== "object") return null;
  const detail = candidate as Partial<RequestDetail>;
  if (detail.id === undefined || detail.timestamp === undefined) return null;
  return detail as RequestDetail;
}

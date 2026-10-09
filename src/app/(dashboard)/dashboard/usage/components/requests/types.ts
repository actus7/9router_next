/** Contract of GET /api/usage/requests — one row per gateway request. */

/** The routing story of one request: who was asked for, who answered, and what
 *  happened between the two. */
export interface RequestAttempt {
  model: string;
  provider?: string;
  connection?: string;
  outcome: "ok" | "failed" | "aborted" | "cooldown_skip";
  status?: number;
  errorClass?: string;
  error?: string;
  durationMs?: number;
  startOffsetMs?: number;
  /** The credential-free default answered because the model before it had no account left. */
  freeFallback?: boolean;
}

export interface RequestRoutingInfo {
  /** Every model/account tried, in order, including the one that answered. */
  attempts?: RequestAttempt[];
  requested?: string | null;
  selected?: string | null;
  steps?: number;
  switched?: number;
  failed?: number;
  combo?: string | null;
  tier?: string | null;
  truncated?: boolean;
}

export interface RequestRow {
  id: number;
  timestamp: string;
  provider?: string | null;
  model?: string | null;
  connectionId?: string;
  endpoint?: string;
  promptTokens?: number;
  completionTokens?: number;
  cost?: number | null;
  statusLabel?: string;
  statusRaw?: string;
  tokens?: {
    cached_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  routing?: RequestRoutingInfo | null;
  /** requestDetails id of the same request, when bodies were recorded. */
  detailId?: string | number | null;
}

export interface RequestsResponse {
  requests: RequestRow[];
  pagination: { page: number; pageSize: number; totalItems: number };
  filterOptions?: { providers?: string[]; models?: string[]; apiKeys?: Array<{ id: string; name: string | null }> };
}

export interface RequestFilters {
  status: "" | "success" | "failed";
  model: string;
  provider: string;
  apiKey: string;
  range: "" | "24h" | "7d" | "30d" | "90d" | "365d";
  fallback: boolean;
  hasFailed: boolean;
}

export const EMPTY_FILTERS: RequestFilters = {
  status: "",
  model: "",
  provider: "",
  apiKey: "",
  range: "",
  fallback: false,
  hasFailed: false,
};

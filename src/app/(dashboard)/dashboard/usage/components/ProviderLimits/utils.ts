// @ts-nocheck
import { getModelsByProviderId } from "@/lib/open-sse/config/providerModels";

// ─── Constants ───────────────────────────────────────────────────────────────
export const QUOTA_CACHE_KEY = "quotaCacheData";
export const REFRESH_INTERVAL_MS = 60000;
// Claude usage/quota endpoint rate-limits; poll it less often than other providers
export const CLAUDE_REFRESH_INTERVAL_MS = 600000;
export const DEPLETED_QUOTA_THRESHOLD = 5;
export const AUTO_REFRESH_STORAGE_KEY = "quotaAutoRefresh";
export const CONNECTIONS_PAGE_SIZE = 20;
export const ACCOUNT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
export const ACCOUNT_PAGE_SIZE_MAX = 500;
export const ACCOUNT_FILTER_OPTIONS = [
  { value: "all", label: "All accounts" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Turned off" },
];
export const QUOTA_SORT_OPTIONS = [
  { value: "default", label: "Default quota order" },
  { value: "remaining-asc", label: "% quota: low to high" },
  { value: "remaining-desc", label: "% quota: high to low" },
];

export interface QuotaEntry {
  name: string;
  modelKey?: string;
  used: number;
  total: number;
  remaining?: number;
  remainingPercentage?: number;
  resetAt?: string | null;
  recurring?: boolean;
  unit?: string;
  message?: string;
}

export interface QuotaData {
  quotas: QuotaEntry[];
  plan?: string | null;
  message?: string | null;
  raw?: Record<string, unknown>;
}

export interface Connection {
  id: string;
  provider: string;
  name?: string;
  email?: string;
  displayName?: string;
  isActive?: boolean;
  authType?: string;
  testStatus?: string;
  providerSpecificData?: Record<string, unknown>;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Totals {
  eligibleConnections: number;
  providerFilteredConnections: number;
}

export interface EmptyState {
  icon: string;
  title: string;
  description: string;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────
export function getConnectionLabel(connection: Connection): string | null {
  return connection.name?.trim()
    || connection.email?.trim()
    || connection.displayName?.trim()
    || null;
}

export function getConnectionQuotaRemaining(connection: Connection, quotaData: Record<string, QuotaData>): number {
  const quota = quotaData[connection.id]?.quotas?.[0];
  if (!quota) return Number.POSITIVE_INFINITY;
  if (typeof quota.remaining === "number") return quota.remaining;
  return Number.POSITIVE_INFINITY;
}

// Stable group-by-provider: first-seen provider order, original order within group.
function groupByProviderStable(connections: Connection[]): Connection[] {
  const seen = new Map<string, Connection[]>();
  for (const conn of connections) {
    const key = conn.provider || "";
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key)!.push(conn);
  }
  return Array.from(seen.values()).flat();
}

export function sortVisibleConnections(
  connections: Connection[],
  quotaData: Record<string, QuotaData>,
  expiringFirst: boolean,
  providerFilter: string,
  quotaSortMode: string,
): Connection[] {
  if (providerFilter === "codex" && quotaSortMode !== "default") {
    return [...connections].sort((a, b) => {
      const remainingA = getConnectionQuotaRemaining(a, quotaData);
      const remainingB = getConnectionQuotaRemaining(b, quotaData);
      const remainingDiff =
        quotaSortMode === "remaining-asc"
          ? remainingA - remainingB
          : remainingB - remainingA;
      if (remainingDiff !== 0) return remainingDiff;
      return (getConnectionLabel(a) || "").localeCompare(
        getConnectionLabel(b) || "",
      );
    });
  }

  if (!expiringFirst) return groupByProviderStable(connections);

  const getEarliestResetTime = (connection: Connection): number => {
    const resetTimes = (quotaData[connection.id]?.quotas || [])
      .map((quota) =>
        quota.resetAt
          ? new Date(quota.resetAt).getTime()
          : Number.POSITIVE_INFINITY,
      )
      .filter((time) => Number.isFinite(time));
    return resetTimes.length > 0
      ? Math.min(...resetTimes)
      : Number.POSITIVE_INFINITY;
  };

  return [...connections].sort((a, b) => {
    const expiryDiff = getEarliestResetTime(a) - getEarliestResetTime(b);
    if (expiryDiff !== 0) return expiryDiff;
    return (
      (a.provider || "").localeCompare(b.provider || "") ||
      (getConnectionLabel(a) || "").localeCompare(getConnectionLabel(b) || "")
    );
  });
}

export function buildLoadingState(connections: Connection[]): Record<string, boolean> {
  const nextLoadingState: Record<string, boolean> = {};
  connections.forEach((connection) => {
    nextLoadingState[connection.id] = true;
  });
  return nextLoadingState;
}

export function filterQuotaStateByConnections<T>(state: Record<string, T>, connections: Connection[]): Record<string, T> {
  const visibleIds = new Set(connections.map((connection) => connection.id));
  return Object.fromEntries(
    Object.entries(state).filter(([id]) => visibleIds.has(id)),
  );
}

export function getConnectionsPageRange(pagination: Pagination): { start: number; end: number } {
  if (!pagination.total) {
    return { start: 0, end: 0 };
  }
  const start = (pagination.page - 1) * pagination.pageSize + 1;
  const end = Math.min(pagination.page * pagination.pageSize, pagination.total);
  return { start, end };
}

export function getConnectionsEmptyMessage(totals: Totals, providerFilter: string, accountFilter: string): EmptyState {
  if (!totals.eligibleConnections) {
    return {
      icon: "cloud_off",
      title: "No Providers Connected",
      description:
        "Connect to providers with OAuth to track your API quota limits and usage.",
    };
  }
  if (!totals.providerFilteredConnections) {
    return {
      icon: "filter_alt_off",
      title: "No Accounts Match Current Filters",
      description:
        providerFilter === "all"
          ? "Try changing the account status filter to see more quota trackers."
          : `No ${accountFilter === "inactive" ? "turned off" : accountFilter === "active" ? "active" : "matching"} accounts found for ${providerFilter}.`,
    };
  }
  return {
    icon: "filter_alt_off",
    title: "No Accounts On This Page",
    description:
      "Try moving to another page or refreshing the current filters.",
  };
}

export function sortRequestFromExpiringFirst(expiringFirst: boolean): string {
  return expiringFirst ? "expiring" : "priority";
}

export function getPageSizeLabel(pageSize: number, isCustomPageSize: boolean): string {
  return isCustomPageSize ? `Custom: ${pageSize} / page` : `${pageSize} / page`;
}

export function getConnectionsPaginationSummary(pagination: Pagination): string {
  const { start, end } = getConnectionsPageRange(pagination);
  return `Showing ${start}-${end} of ${pagination.total}`;
}

export function getSafePagination(pagination: Pagination | null, fallbackPageSize: number): Pagination {
  return (
    pagination || {
      page: 1,
      pageSize: fallbackPageSize,
      total: 0,
      totalPages: 1,
    }
  );
}

export function getSafeTotals(totals: Totals | null, fallbackTotal = 0): Totals {
  return (
    totals || {
      eligibleConnections: fallbackTotal,
      providerFilteredConnections: fallbackTotal,
    }
  );
}

export function shouldResetPage(previousValue: string, nextValue: string): boolean {
  return previousValue !== nextValue;
}

export function getPaginationPageValue(dataPagination: Pagination | null, fallbackPage: number): number {
  return dataPagination?.page || fallbackPage;
}

export function getProviderOptions(dataProviderOptions: string[] | null): string[] {
  return dataProviderOptions || [];
}

export async function reconcileConnectionsPage(fetchConnections: (page: number) => Promise<Connection[]>, targetPage: number): Promise<Connection[]> {
  return await fetchConnections(targetPage);
}

export function getQuotaCache(): Record<string, QuotaData & { cachedAt?: string }> {
  if (typeof window === "undefined") return {};
  try {
    const cached = window.localStorage.getItem(QUOTA_CACHE_KEY);
    return cached ? JSON.parse(cached) : {};
  } catch (error) {
    console.error("Error reading quota cache:", error);
    return {};
  }
}

export function setQuotaCache(connectionId: string, quotaEntry: QuotaData): void {
  if (typeof window === "undefined") return;
  try {
    const cache = getQuotaCache();
    cache[connectionId] = {
      ...quotaEntry,
      cachedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(QUOTA_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.error("Error writing quota cache:", error);
  }
}

/**
 * Format ISO date string to countdown format (inspired by vscode-antigravity-cockpit)
 * @param date - ISO date string or Date object
 * @returns Formatted countdown (e.g., "2d 5h 30m", "4h 40m", "15m") or "-"
 */
export function formatResetTime(date: string | Date | null | undefined): string {
  if (!date) return "-";

  try {
    const resetDate = typeof date === "string" ? new Date(date) : date;
    const now = new Date();
    const diffMs = resetDate.getTime() - now.getTime();

    if (diffMs <= 0) return "-";

    const totalMinutes = Math.ceil(diffMs / (1000 * 60));
    
    // < 60 minutes: show only minutes
    if (totalMinutes < 60) {
      return `${totalMinutes}m`;
    }
    
    const totalHours = Math.floor(totalMinutes / 60);
    const remainingMinutes = totalMinutes % 60;
    
    // < 24 hours: show hours and minutes
    if (totalHours < 24) {
      return `${totalHours}h ${remainingMinutes}m`;
    }
    
    // >= 24 hours: show days, hours, and minutes
    const days = Math.floor(totalHours / 24);
    const remainingHours = totalHours % 24;
    return `${days}d ${remainingHours}h ${remainingMinutes}m`;
  } catch (error) {
    return "-";
  }
}

/**
 * Get Tailwind color class based on percentage
 * @param percentage - Remaining percentage (0-100)
 * @returns Color name: "green" | "yellow" | "red"
 */
export function getStatusColor(percentage: number): string {
  if (percentage > 70) return "green";
  if (percentage >= 30) return "yellow";
  return "red"; // 0-29% including 0% (out of quota) - show red
}

/**
 * Get status emoji based on percentage
 * @param percentage - Remaining percentage (0-100)
 * @returns Emoji: "🟢" | "🟡" | "🔴"
 */
export function getStatusEmoji(percentage: number): string {
  if (percentage > 70) return "🟢";
  if (percentage >= 30) return "🟡";
  return "🔴"; // 0-29% including 0% (out of quota) - show red
}

/**
 * Calculate remaining percentage
 * @param used - Used amount
 * @param total - Total amount
 * @returns Remaining percentage (0-100)
 */
export function calculatePercentage(used: number, total: number): number {
  if (!total || total === 0) return 0;
  if (!used || used < 0) return 100;
  if (used >= total) return 0;

  return Math.round(((total - used) / total) * 100);
}

/**
 * Get remaining percentage from a normalized quota row
 * @param quota - Normalized quota object
 * @returns Remaining percentage (0-100)
 */
export function getRemainingPercentage(quota: QuotaEntry): number {
  if (quota?.remaining !== undefined) {
    return Math.max(0, Math.round(quota.remaining));
  }

  if (quota?.remainingPercentage !== undefined) {
    return Math.round(quota.remainingPercentage);
  }

  return calculatePercentage(quota?.used, quota?.total);
}

export function getQuotaVisibilityKey(quota: QuotaEntry): string {
  if (!quota || typeof quota !== "object") return "";
  return String(quota.modelKey || quota.name || "").trim();
}

function getProviderHiddenQuotaSet(provider: string, quotaVisibility: Record<string, { hidden?: string[] }>): Set<string> {
  const hidden = quotaVisibility?.[provider]?.hidden;
  return new Set(Array.isArray(hidden) ? hidden.map(String) : []);
}

export function filterQuotasByVisibility(provider: string, quotas: QuotaEntry[] = [], quotaVisibility: Record<string, { hidden?: string[] }> = {}): QuotaEntry[] {
  if (!Array.isArray(quotas) || quotas.length === 0) return [];
  const hidden = getProviderHiddenQuotaSet(provider, quotaVisibility);
  if (hidden.size === 0) return quotas;
  return quotas.filter((quota) => !hidden.has(getQuotaVisibilityKey(quota)));
}

export function getHiddenQuotaRows(provider: string, quotas: QuotaEntry[] = [], quotaVisibility: Record<string, { hidden?: string[] }> = {}): QuotaEntry[] {
  if (!Array.isArray(quotas) || quotas.length === 0) return [];
  const hidden = getProviderHiddenQuotaSet(provider, quotaVisibility);
  if (hidden.size === 0) return [];
  return quotas.filter((quota) => hidden.has(getQuotaVisibilityKey(quota)));
}

/**
 * Parse provider-specific quota structures into normalized array
 * @param provider - Provider name (github, antigravity, codex, kiro, claude)
 * @param data - Raw quota data from provider
 * @returns Normalized quota objects with { name, used, total, resetAt }
 */
export function parseQuotaData(provider: string, data: Record<string, unknown>): QuotaEntry[] {
  if (!data || typeof data !== "object") return [];

  const normalizedQuotas: QuotaEntry[] = [];

  try {
    const quotas = data.quotas as Record<string, Record<string, unknown>> | undefined;
    switch (provider.toLowerCase()) {
      case "github":
        if (quotas) {
          Object.entries(quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: (quota.used as number) || 0,
              total: (quota.total as number) || 0,
              resetAt: (quota.resetAt as string) || null,
            });
          });
        }
        break;

      case "antigravity":
        if (quotas) {
          Object.entries(quotas).forEach(([modelKey, quota]) => {
            normalizedQuotas.push({
              name: (quota.displayName as string) || modelKey,
              modelKey: modelKey,
              used: (quota.used as number) || 0,
              total: (quota.total as number) || 0,
              resetAt: (quota.resetAt as string) || null,
              remainingPercentage: quota.remainingPercentage as number | undefined,
            });
          });
        }
        break;

      case "codex":
        if (quotas) {
          Object.entries(quotas).forEach(([quotaType, quota]) => {
            normalizedQuotas.push({
              name: quotaType,
              used: (quota.used as number) || 0,
              total: (quota.total as number) || 0,
              remaining: quota.remaining as number | undefined,
              resetAt: (quota.resetAt as string) || null,
            });
          });
        }
        break;

      case "kiro":
        if (quotas) {
          Object.entries(quotas).forEach(([quotaType, quota]) => {
            normalizedQuotas.push({
              name: quotaType,
              used: (quota.used as number) || 0,
              total: (quota.total as number) || 0,
              resetAt: (quota.resetAt as string) || null,
            });
          });
        }
        break;

      case "qoder":
        if (quotas) {
          Object.entries(quotas).forEach(([quotaType, quota]) => {
            if (quotaType === "organization" && (!quota || (Number(quota.total) || 0) === 0)) {
              return;
            }
            normalizedQuotas.push({
              name: quotaType === "user" ? "Personal" : quotaType === "organization" ? "Organization" : quotaType,
              used: (quota.used as number) || 0,
              total: (quota.total as number) || 0,
              unit: quota.unit as string | undefined,
              resetAt: (quota.resetAt as string) || null,
            });
          });
        }
        break;

      case "claude":
        if (data.message) {
          normalizedQuotas.push({
            name: "error",
            used: 0,
            total: 0,
            resetAt: null,
            message: data.message as string,
          });
        } else if (quotas) {
          Object.entries(quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: (quota.used as number) || 0,
              total: (quota.total as number) || 0,
              resetAt: (quota.resetAt as string) || null,
            });
          });
        }
        break;

      case "vercel-ai-gateway":
        if (quotas) {
          Object.entries(quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: (quota.used as number) || 0,
              total: (quota.total as number) || 0,
              resetAt: (quota.resetAt as string) || null,
              remainingPercentage: quota.remainingPercentage as number | undefined,
            });
          });
        }
        break;

      case "codebuddy-cn":
        if (quotas) {
          Object.entries(quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: (quota.used as number) || 0,
              total: (quota.total as number) || 0,
              resetAt: (quota.resetAt as string) || null,
              recurring: quota.recurring !== false,
            });
          });
        }
        break;

      case "grok-cli":
        if (quotas) {
          Object.entries(quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: (quota.used as number) || 0,
              total: (quota.total as number) || 0,
              resetAt: (quota.resetAt as string) || null,
              remainingPercentage: quota.remainingPercentage as number | undefined,
            });
          });
        }
        break;

      case "kimi":
        if (quotas) {
          Object.entries(quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: (quota.used as number) || 0,
              total: (quota.total as number) || 0,
              resetAt: (quota.resetAt as string) || null,
              remainingPercentage: quota.remainingPercentage as number | undefined,
            });
          });
        }
        break;

      case "deepseek":
        if (quotas) {
          Object.entries(quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: (quota.used as number) || 0,
              total: (quota.total as number) || 0,
              resetAt: (quota.resetAt as string) || null,
              remainingPercentage: quota.remainingPercentage as number | undefined,
            });
          });
        }
        break;

      case "ollama":
        if (quotas) {
          Object.entries(quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: (quota.used as number) || 0,
              total: (quota.total as number) || 0,
              resetAt: (quota.resetAt as string) || null,
              remainingPercentage: quota.remainingPercentage as number | undefined,
            });
          });
        }
        break;

      default:
        if (quotas) {
          Object.entries(quotas).forEach(([name, quota]) => {
            normalizedQuotas.push({
              name,
              used: (quota.used as number) || 0,
              total: (quota.total as number) || 0,
              resetAt: (quota.resetAt as string) || null,
            });
          });
        }
    }
  } catch (error) {
    console.error(`Error parsing quota data for ${provider}:`, error);
    return [];
  }

  // Sort quotas according to PROVIDER_MODELS order
  const modelOrder = getModelsByProviderId(provider);
  if (modelOrder.length > 0) {
    const orderMap = new Map(modelOrder.map((m: { id: string }, i: number) => [m.id, i]));
    
    normalizedQuotas.sort((a, b) => {
      const keyA = a.modelKey || a.name;
      const keyB = b.modelKey || b.name;
      const orderA = orderMap.get(keyA) ?? 999;
      const orderB = orderMap.get(keyB) ?? 999;
      return orderA - orderB;
    });
  }

  return normalizedQuotas;
}

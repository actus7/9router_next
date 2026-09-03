import type { QuotaEntry } from "./quotaTypes";

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

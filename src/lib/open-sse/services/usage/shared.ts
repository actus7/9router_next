/**
 * Shared usage helpers (cross-provider)
 */

import { PROVIDERS } from "../../providers/index";
import { proxyAwareFetch as _proxyAwareFetch } from "../../utils/proxyFetch";

// Typed wrapper for the untyped proxyAwareFetch
type ProxyFetchFn = (url: string, options?: RequestInit, proxyOptions?: unknown) => Promise<unknown>;
const proxyAwareFetch = _proxyAwareFetch as unknown as ProxyFetchFn;

// usage endpoints: single source from registry transport.usage
export const U = (id: string): Record<string, unknown> =>
  (PROVIDERS[id]?.usage as Record<string, unknown>) || {};

/**
 * Parse reset date/time to ISO string
 * Handles multiple formats: Unix timestamp (ms), ISO date string, etc.
 */
export function parseResetTime(resetValue: unknown): string | null {
  if (!resetValue) return null;

  try {
    // If it's already a Date object
    if (resetValue instanceof Date) {
      return resetValue.toISOString();
    }

    // Unix timestamps from provider APIs may be seconds or milliseconds.
    if (typeof resetValue === "number") {
      return new Date(resetValue < 1e12 ? resetValue * 1000 : resetValue).toISOString();
    }

    // If it's a numeric string, treat it like a Unix timestamp too.
    if (typeof resetValue === "string") {
      if (/^\d+$/.test(resetValue)) {
        const timestamp = Number(resetValue);
        return new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp).toISOString();
      }
      return new Date(resetValue).toISOString();
    }

    return null;
  } catch (error) {
    console.warn(`Failed to parse reset time: ${resetValue}`, error);
    return null;
  }
}

export function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function normalizeCloudCodeProjectId(project: unknown): string | null {
  if (typeof project === "string") return project.trim() || null;
  if (project && typeof project === "object" && typeof (project as Record<string, unknown>).id === "string") {
    return ((project as Record<string, unknown>).id as string).trim() || null;
  }
  return null;
}

export async function fetchWithTimeout(url: string, opts: RequestInit, ms = 10000, proxyOptions: unknown = null): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    return await proxyAwareFetch(url, { ...opts, signal: controller.signal }, proxyOptions);
  } finally {
    clearTimeout(timeoutId);
  }
}

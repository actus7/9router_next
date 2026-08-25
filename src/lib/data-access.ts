/**
 * Server-side data access layer.
 *
 * Provides typed convenience functions for fetching data directly from the
 * database, bypassing HTTP API routes.  Every function is async and delegates
 * to the underlying repository modules under {@link @/lib/db/repos}.
 *
 * This module is server-only — do NOT add a `'use client'` directive.
 */

import {
  getProviderConnections,
  getProviderConnectionById,
  updateProviderConnection,
} from "@/lib/db/repos/connectionsRepo";

import {
  getProviderNodes as repoGetProviderNodes,
} from "@/lib/db/repos/nodesRepo";

import {
  getCombos as repoGetCombos,
  getComboById as repoGetComboById,
} from "@/lib/db/repos/combosRepo";

import {
  getSettings as repoGetSettings,
  updateSettings as repoUpdateSettings,
} from "@/lib/db/repos/settingsRepo";

import {
  getApiKeys as repoGetApiKeys,
} from "@/lib/db/repos/apiKeysRepo";

import {
  getProxyPools as repoGetProxyPools,
} from "@/lib/db/repos/proxyPoolsRepo";

import {
  getUsageStats as repoGetUsageStats,
  getUsageHistory,
} from "@/lib/db/repos/usageRepo";

// ---------------------------------------------------------------------------
// Re-exported types (so consumers can import from a single module)
// ---------------------------------------------------------------------------

export type Connection = Awaited<ReturnType<typeof getProviderConnections>>[number];
export type ProviderNode = Awaited<ReturnType<typeof repoGetProviderNodes>>[number];
export type Combo = Awaited<ReturnType<typeof repoGetCombos>>[number];
export type Settings = Awaited<ReturnType<typeof repoGetSettings>>;
export type ApiKey = Awaited<ReturnType<typeof repoGetApiKeys>>[number];
export type ProxyPool = Awaited<ReturnType<typeof repoGetProxyPools>>[number];
export type UsageStats = Awaited<ReturnType<typeof repoGetUsageStats>>;
export type UsageLog = Awaited<ReturnType<typeof getUsageHistory>>[number];

export interface UsageLogsParams {
  provider?: string;
  model?: string;
  startDate?: string;
  endDate?: string;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/**
 * Fetch all provider connections (API keys, OAuth accounts, etc.).
 */
export async function getProviders(): Promise<Connection[]> {
  try {
    return await getProviderConnections();
  } catch (err) {
    console.error("[data-access] getProviders failed:", err);
    return [];
  }
}

/**
 * Fetch a single provider connection by its id, or `null` if not found.
 */
export async function getProviderById(id: string): Promise<Connection | null> {
  try {
    return await getProviderConnectionById(id);
  } catch (err) {
    console.error("[data-access] getProviderById failed:", err);
    return null;
  }
}

/**
 * Fetch all provider nodes (endpoint definitions).
 */
export async function getProviderNodes(): Promise<ProviderNode[]> {
  try {
    return await repoGetProviderNodes();
  } catch (err) {
    console.error("[data-access] getProviderNodes failed:", err);
    return [];
  }
}

/**
 * Toggle the `isActive` flag on a provider connection.
 */
export async function toggleProviderActive(id: string, active: boolean): Promise<void> {
  try {
    await updateProviderConnection(id, { isActive: active });
  } catch (err) {
    console.error("[data-access] toggleProviderActive failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Combos
// ---------------------------------------------------------------------------

/**
 * Fetch all combos (model groups / fallback chains).
 */
export async function getCombos(): Promise<Combo[]> {
  try {
    return await repoGetCombos();
  } catch (err) {
    console.error("[data-access] getCombos failed:", err);
    return [];
  }
}

/**
 * Fetch a single combo by its id, or `null` if not found.
 */
export async function getComboById(id: string): Promise<Combo | null> {
  try {
    return await repoGetComboById(id);
  } catch (err) {
    console.error("[data-access] getComboById failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * Fetch the current application settings (merged with defaults).
 */
export async function getSettings(): Promise<Settings> {
  try {
    return await repoGetSettings();
  } catch (err) {
    console.error("[data-access] getSettings failed:", err);
    throw err;
  }
}

/**
 * Partially update application settings.
 */
export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  try {
    await repoUpdateSettings(patch as Record<string, unknown>);
  } catch (err) {
    console.error("[data-access] updateSettings failed:", err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

/**
 * Fetch all API keys.
 */
export async function getApiKeys(): Promise<ApiKey[]> {
  try {
    return await repoGetApiKeys();
  } catch (err) {
    console.error("[data-access] getApiKeys failed:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Proxy Pools
// ---------------------------------------------------------------------------

/**
 * Fetch all proxy pools.
 */
export async function getProxyPools(): Promise<ProxyPool[]> {
  try {
    return await repoGetProxyPools();
  } catch (err) {
    console.error("[data-access] getProxyPools failed:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

/**
 * Fetch aggregated usage statistics.
 */
export async function getUsageStats(): Promise<UsageStats> {
  try {
    return await repoGetUsageStats();
  } catch (err) {
    console.error("[data-access] getUsageStats failed:", err);
    throw err;
  }
}

/**
 * Fetch individual usage log entries, optionally filtered.
 */
export async function getUsageLogs(params: UsageLogsParams): Promise<UsageLog[]> {
  try {
    return await getUsageHistory({
      provider: params.provider,
      model: params.model,
      startDate: params.startDate,
      endDate: params.endDate,
    });
  } catch (err) {
    console.error("[data-access] getUsageLogs failed:", err);
    return [];
  }
}

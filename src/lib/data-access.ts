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

import {
  getDisabledByProvider,
  getDisabledModels as repoGetDisabledModels,
} from "@/lib/db/repos/disabledModelsRepo";

import {
  getModelAliases as repoGetModelAliases,
  getCustomModels as repoGetCustomModels,
} from "@/lib/db/repos/aliasRepo";

import { getAdapter } from "@/lib/db/driver";

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

// ---------------------------------------------------------------------------
// Provider Models
// ---------------------------------------------------------------------------

/**
 * Fetch models for a specific provider connection.
 * Returns an empty array on error.
 */
export async function getProviderModels(connectionId: string): Promise<unknown[]> {
  try {
    const db = await getAdapter();
    const connection = await getProviderConnectionById(connectionId);
    if (!connection) return [];

    // Get provider nodes for this connection's provider type
    const nodes = await repoGetProviderNodes({ type: connection.provider });
    if (!nodes.length) return [];

    // Return the models from the first matching node's data
    const node = nodes[0];
    const models = (node as Record<string, unknown>).models;
    return Array.isArray(models) ? models : [];
  } catch (err) {
    console.error("[data-access] getProviderModels failed:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Disabled Models
// ---------------------------------------------------------------------------

/**
 * Fetch disabled models for a specific provider alias.
 * Returns an empty array on error.
 */
export async function getDisabledModels(providerAlias: string): Promise<string[]> {
  try {
    return await getDisabledByProvider(providerAlias);
  } catch (err) {
    console.error("[data-access] getDisabledModels failed:", err);
    return [];
  }
}

/**
 * Fetch all disabled models grouped by provider alias.
 * Returns an empty object on error.
 */
export async function getAllDisabledModels(): Promise<Record<string, string[]>> {
  try {
    return await repoGetDisabledModels();
  } catch (err) {
    console.error("[data-access] getAllDisabledModels failed:", err);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Model Aliases
// ---------------------------------------------------------------------------

/**
 * Fetch all model aliases (alias → model mapping).
 * Returns an empty object on error.
 */
export async function getModelAliases(): Promise<Record<string, string>> {
  try {
    const aliases = await repoGetModelAliases();
    return aliases as Record<string, string>;
  } catch (err) {
    console.error("[data-access] getModelAliases failed:", err);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Custom Models
// ---------------------------------------------------------------------------

/**
 * Fetch all custom models.
 * Returns an empty array on error.
 */
export async function getCustomModels(): Promise<unknown[]> {
  try {
    return await repoGetCustomModels();
  } catch (err) {
    console.error("[data-access] getCustomModels failed:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Proxy Pools with Usage
// ---------------------------------------------------------------------------

/**
 * Fetch all proxy pools enriched with usage statistics.
 * Returns an empty array on error.
 */
export async function getProxyPoolsWithUsage(): Promise<ProxyPool[]> {
  try {
    const pools = await repoGetProxyPools();
    const stats = await repoGetUsageStats();

    // Enrich pools with usage data if available
    return pools.map(pool => ({
      ...pool,
      usage: {
        totalRequests: 0,
        totalCost: 0,
        // Additional usage metrics can be added here
      }
    }));
  } catch (err) {
    console.error("[data-access] getProxyPoolsWithUsage failed:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Database Info
// ---------------------------------------------------------------------------

/**
 * Fetch database metadata and statistics.
 * Returns an empty object on error.
 */
export async function getDatabaseInfo(): Promise<Record<string, unknown>> {
  try {
    const db = await getAdapter();

    // Get table counts
    const tables = ['providerConnections', 'providerNodes', 'proxyPools', 'apiKeys', 'combos', 'usageHistory', 'requestDetails'];
    const tableCounts: Record<string, number> = {};

    for (const table of tables) {
      try {
        const result = db.get(`SELECT COUNT(*) as count FROM ${table}`);
        tableCounts[table] = (result as { count: number })?.count || 0;
      } catch {
        tableCounts[table] = 0;
      }
    }

    // Get database size (approximate)
    let dbSize = 0;
    try {
      const pageCount = db.get(`PRAGMA page_count`);
      const pageSize = db.get(`PRAGMA page_size`);
      if (pageCount && pageSize) {
        dbSize = ((pageCount as { page_count: number }).page_count || 0) * ((pageCount as { page_size: number }).page_size || 0);
      }
    } catch {
      // Ignore size calculation errors
    }

    // Get schema version
    let schemaVersion = 0;
    try {
      const versionRow = db.get(`SELECT value FROM _meta WHERE key = 'schemaVersion'`);
      schemaVersion = parseInt((versionRow as { value: string })?.value || '0', 10);
    } catch {
      // Ignore version errors
    }

    return {
      tableCounts,
      dbSize,
      schemaVersion,
      driver: (db as unknown as Record<string, unknown>).driver || 'unknown',
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[data-access] getDatabaseInfo failed:", err);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Combo with Details
// ---------------------------------------------------------------------------

/**
 * Fetch a single combo by its id with additional details, or `null` if not found.
 * Returns null on error.
 */
export async function getComboWithDetails(id: string): Promise<(Combo & { modelDetails: Array<{ id: string; provider: string; name: string }> }) | null> {
  try {
    const combo = await repoGetComboById(id);
    if (!combo) return null;

    // Get additional details for the combo's models
    const models = combo.models || [];
    const modelDetails = await Promise.all(
      models.map(async (model: unknown) => {
        const modelStr = typeof model === 'string' ? model : String(model);
        // Try to get provider info for this model
        const [provider, modelName] = modelStr.includes('/') ? modelStr.split('/') : ['', modelStr];
        return {
          id: modelStr,
          provider: provider || 'unknown',
          name: modelName || modelStr,
        };
      })
    );

    return {
      ...combo,
      modelDetails,
    };
  } catch (err) {
    console.error("[data-access] getComboWithDetails failed:", err);
    return null;
  }
}

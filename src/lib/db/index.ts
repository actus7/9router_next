// Public API barrel — all DB functions
import { getAdapter } from "./driver";
import { currentTenantId } from "./tenant";
import { stringifyJson, parseJson } from "./helpers/jsonCol";

// Settings
export {
  getSettings, updateSettings, isCloudEnabled, getCloudUrl, exportSettings,
} from "./repos/settingsRepo";

// Provider connections
export {
  getProviderConnections, getProviderConnectionById,
  createProviderConnection, updateProviderConnection,
  deleteProviderConnection, deleteProviderConnectionsByProvider,
  reorderProviderConnections, cleanupProviderConnections,
} from "./repos/connectionsRepo";

// Provider nodes
export {
  getProviderNodes, getProviderNodeById,
  createProviderNode, updateProviderNode, deleteProviderNode,
} from "./repos/nodesRepo";

// Proxy pools
export {
  getProxyPools, getProxyPoolById,
  createProxyPool, updateProxyPool, deleteProxyPool,
} from "./repos/proxyPoolsRepo";

// Cloud deploy
export {
  getCloudConnections, getCloudConnectionByProvider, getCloudConnectionById,
  createCloudConnection, deleteCloudConnection,
} from "./repos/cloudConnectionsRepo";
export {
  getCloudDeployments, getCloudDeploymentById,
  createCloudDeployment, updateCloudDeployment, deleteCloudDeployment,
} from "./repos/cloudDeploymentsRepo";

// API keys
export {
  getApiKeys, getApiKeyById, createApiKey, updateApiKey, deleteApiKey, validateApiKey,
} from "./repos/apiKeysRepo";

// Combos
export {
  getCombos, getComboById, getComboByName,
  createCombo, updateCombo, deleteCombo,
} from "./repos/combosRepo";

export {
  getSmartModelProfiles, getSmartModelProfile,
  upsertSmartModelProfiles, deleteSmartModelProfiles,
} from "./repos/smartModelProfilesRepo";

export {
  getActiveModelAvailability, setModelAvailability, clearModelAvailability,
  clearProviderModelAvailability, cleanupExpiredModelAvailability,
} from "./repos/modelAvailabilityRepo";

// Aliases (model + custom)
export {
  getModelAliases, setModelAlias, deleteModelAlias,
  getCustomModels, addCustomModel, deleteCustomModel, syncDiscoveredCustomModels,
} from "./repos/aliasRepo";

// Pricing
export {
  getPricing, updatePricing, resetPricing, resetAllPricing,
} from "./repos/pricingRepo";

// Disabled models
export {
  getDisabledModels, disableModels, enableModels,
} from "./repos/disabledModelsRepo";

// Usage
export {
  statsEmitter, statsEventName, trackPendingRequest, getActiveRequests,
  saveRequestUsage, getUsageHistory, getUsageStats, getChartData,
  appendRequestLog, getRecentLogs,
} from "./repos/usageRepo";

// Request details
export {
  saveRequestDetail, getRequestDetails, getRequestDetailById, getDistinctProviders,
} from "./repos/requestDetailsRepo";

// Export/import full DB
export async function exportDb(): Promise<Record<string, unknown>> {
  const db = await getAdapter();
  const { exportSettings } = await import("./repos/settingsRepo");

  const out: Record<string, unknown> = {
    settings: await exportSettings(),
    providerConnections: (await db.all(`SELECT * FROM providerConnections WHERE userId = ?`, [currentTenantId()]) as Array<Record<string, unknown>>).map((r: Record<string, unknown>) => ({ ...(parseJson(r.data, {}) as Record<string, unknown>), id: r.id, provider: r.provider, authType: r.authType, name: r.name, email: r.email, priority: r.priority, isActive: r.isActive === 1, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    providerNodes: (await db.all(`SELECT * FROM providerNodes WHERE userId = ?`, [currentTenantId()]) as Array<Record<string, unknown>>).map((r: Record<string, unknown>) => ({ ...(parseJson(r.data, {}) as Record<string, unknown>), id: r.id, type: r.type, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    proxyPools: (await db.all(`SELECT * FROM proxyPools WHERE userId = ?`, [currentTenantId()]) as Array<Record<string, unknown>>).map((r: Record<string, unknown>) => ({ ...(parseJson(r.data, {}) as Record<string, unknown>), id: r.id, isActive: r.isActive === 1, testStatus: r.testStatus, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    apiKeys: (await db.all(`SELECT * FROM apiKeys WHERE userId = ?`, [currentTenantId()]) as Array<Record<string, unknown>>).map((r: Record<string, unknown>) => ({ id: r.id, key: r.key, name: r.name, machineId: r.machineId, isActive: r.isActive === 1, createdAt: r.createdAt })),
    combos: (await db.all(`SELECT * FROM combos WHERE userId = ?`, [currentTenantId()]) as Array<Record<string, unknown>>).map((r: Record<string, unknown>) => ({ id: r.id, name: r.name, kind: r.kind, models: parseJson(r.models, []), routing: parseJson(r.routing, null), createdAt: r.createdAt, updatedAt: r.updatedAt })),
    smartModelProfiles: (await db.all(`SELECT * FROM smartModelProfiles WHERE userId = ?`, [currentTenantId()]) as Array<Record<string, unknown>>).map((r: Record<string, unknown>) => ({
      modelKey: r.modelKey,
      inventoryFingerprint: r.inventoryFingerprint,
      source: r.source,
      profile: parseJson(r.profile, {}),
      classifierModel: r.classifierModel,
      sources: parseJson(r.sources, []),
      researchedAt: r.researchedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    modelAvailability: await db.all(`SELECT * FROM modelAvailability WHERE userId = ?`, [currentTenantId()]) as Array<Record<string, unknown>>,
    modelAliases: {} as Record<string, unknown>,
    customModels: [] as unknown[],
    pricing: {} as Record<string, unknown>,
  };

  for (const r of await db.all(`SELECT key, value FROM kv WHERE userId = ? AND scope = 'modelAliases'`, [currentTenantId()]) as Array<Record<string, unknown>>) (out.modelAliases as Record<string, unknown>)[r.key as string] = parseJson(r.value);
  for (const r of await db.all(`SELECT key, value FROM kv WHERE userId = ? AND scope = 'customModels'`, [currentTenantId()]) as Array<Record<string, unknown>>) (out.customModels as unknown[]).push(parseJson(r.value));
  for (const r of await db.all(`SELECT key, value FROM kv WHERE userId = ? AND scope = 'pricing'`, [currentTenantId()]) as Array<Record<string, unknown>>) (out.pricing as Record<string, unknown>)[r.key as string] = parseJson(r.value);

  return out;
}

export async function importDb(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid database payload");
  }
  const db = await getAdapter();

  const userId: string = currentTenantId();
  await db.transaction(async () => {
    // Wipe this account's rows only. `_meta` is instance state and is never
    // part of an export; every other DELETE here is scoped, so one account
    // restoring a backup cannot empty anyone else's tables.
    await db.run(`DELETE FROM settings WHERE userId = ?`, [userId]);
    await db.run(`DELETE FROM providerConnections WHERE userId = ?`, [userId]);
    await db.run(`DELETE FROM providerNodes WHERE userId = ?`, [userId]);
    await db.run(`DELETE FROM proxyPools WHERE userId = ?`, [userId]);
    await db.run(`DELETE FROM apiKeys WHERE userId = ?`, [userId]);
    await db.run(`DELETE FROM combos WHERE userId = ?`, [userId]);
    await db.run(`DELETE FROM smartModelProfiles WHERE userId = ?`, [userId]);
    await db.run(`DELETE FROM modelAvailability WHERE userId = ?`, [userId]);
    await db.run(`DELETE FROM kv WHERE userId = ? AND scope IN ('modelAliases', 'customModels', 'pricing')`, [userId]);

    // Every DO UPDATE below is guarded by `WHERE <table>.userId = excluded.userId`.
    // The ids come straight from the uploaded payload and `ON CONFLICT(id)`
    // matches on the primary key alone — so without the guard an import could
    // name another account's row id and rewrite it in place, `userId` intact.
    // On `apiKeys` that was an account takeover: overwrite the victim's key
    // with one you know and the gateway then authenticates you as them. A row
    // that fails the guard is left alone, which is the right outcome — it was
    // never yours to restore.

    // Settings
    if (payload.settings) {
      await db.run(`INSERT INTO settings(userId, data) VALUES(?, ?) ON CONFLICT(userId) DO UPDATE SET data = excluded.data`, [userId, stringifyJson(payload.settings)]);
    }

    for (const c of (payload.providerConnections || []) as Array<Record<string, unknown>>) {
      const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
      await db.run(
        `INSERT INTO providerConnections(id, userId, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET provider=excluded.provider, authType=excluded.authType, name=excluded.name,
           email=excluded.email, priority=excluded.priority, isActive=excluded.isActive,
           data=excluded.data, createdAt=excluded.createdAt, updatedAt=excluded.updatedAt
         WHERE providerConnections.userId = excluded.userId`,
        [id, userId, provider, authType || "oauth", name || null, email || null, priority || null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const n of (payload.providerNodes || []) as Array<Record<string, unknown>>) {
      const { id, type, name, createdAt, updatedAt, ...rest } = n;
      await db.run(
        `INSERT INTO providerNodes(id, userId, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET type=excluded.type, name=excluded.name, data=excluded.data,
           createdAt=excluded.createdAt, updatedAt=excluded.updatedAt
         WHERE providerNodes.userId = excluded.userId`,
        [id, userId, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const p of (payload.proxyPools || []) as Array<Record<string, unknown>>) {
      const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
      await db.run(
        `INSERT INTO proxyPools(id, userId, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET isActive=excluded.isActive, testStatus=excluded.testStatus,
           data=excluded.data, createdAt=excluded.createdAt, updatedAt=excluded.updatedAt
         WHERE proxyPools.userId = excluded.userId`,
        [id, userId, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const k of (payload.apiKeys || []) as Array<Record<string, unknown>>) {
      await db.run(
        `INSERT INTO apiKeys(id, userId, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET key=excluded.key, name=excluded.name, machineId=excluded.machineId,
           isActive=excluded.isActive, createdAt=excluded.createdAt
         WHERE apiKeys.userId = excluded.userId`,
        [k.id, userId, k.key, k.name || null, k.machineId || null, k.isActive === false ? 0 : 1, k.createdAt || new Date().toISOString()]
      );
    }
    for (const c of (payload.combos || []) as Array<Record<string, unknown>>) {
      await db.run(
        `INSERT INTO combos(id, userId, name, kind, models, routing, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, models=excluded.models,
           routing=excluded.routing, createdAt=excluded.createdAt, updatedAt=excluded.updatedAt
         WHERE combos.userId = excluded.userId`,
        [c.id, userId, c.name, c.kind || null, stringifyJson(c.models || []), c.routing ? stringifyJson(c.routing) : null, c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
      );
    }
    for (const p of (payload.smartModelProfiles || []) as Array<Record<string, unknown>>) {
      await db.run(
        `INSERT INTO smartModelProfiles(userId, modelKey, inventoryFingerprint, source, profile, classifierModel, sources, researchedAt, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(userId, modelKey) DO UPDATE SET inventoryFingerprint=excluded.inventoryFingerprint,
           source=excluded.source, profile=excluded.profile, classifierModel=excluded.classifierModel,
           sources=excluded.sources, researchedAt=excluded.researchedAt, updatedAt=excluded.updatedAt`,
        [userId, p.modelKey, p.inventoryFingerprint, p.source || "deterministic", stringifyJson(p.profile || {}), p.classifierModel || null, stringifyJson(p.sources || []), p.researchedAt || null, p.createdAt || new Date().toISOString(), p.updatedAt || new Date().toISOString()]
      );
    }
    for (const availability of (payload.modelAvailability || []) as Array<Record<string, unknown>>) {
      if (!availability.connectionId || !availability.modelId) continue;
      await db.run(
        `INSERT INTO modelAvailability(userId, connectionId, modelId, status, reason, errorCode, lastError, until, createdAt, updatedAt)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(userId, connectionId, modelId) DO UPDATE SET status=excluded.status, reason=excluded.reason,
           errorCode=excluded.errorCode, lastError=excluded.lastError, until=excluded.until,
           createdAt=excluded.createdAt, updatedAt=excluded.updatedAt`,
        [
          userId,
          availability.connectionId,
          availability.modelId,
          availability.status || "cooldown",
          availability.reason || "legacy",
          availability.errorCode || null,
          availability.lastError || null,
          availability.until || null,
          availability.createdAt || new Date().toISOString(),
          availability.updatedAt || new Date().toISOString(),
        ],
      );
    }
    for (const [a, m] of Object.entries((payload.modelAliases || {}) as Record<string, unknown>)) {
      await db.run(`INSERT INTO kv(userId, scope, key, value) VALUES(?, 'modelAliases', ?, ?) ON CONFLICT(userId, scope, key) DO UPDATE SET value = excluded.value`, [userId, a, stringifyJson(m)]);
    }
    for (const m of (payload.customModels || []) as Array<Record<string, unknown>>) {
      const k: string = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
      await db.run(`INSERT INTO kv(userId, scope, key, value) VALUES(?, 'customModels', ?, ?) ON CONFLICT(userId, scope, key) DO UPDATE SET value = excluded.value`, [userId, k, stringifyJson(m)]);
    }
    for (const [provider, models] of Object.entries((payload.pricing || {}) as Record<string, unknown>)) {
      await db.run(`INSERT INTO kv(userId, scope, key, value) VALUES(?, 'pricing', ?, ?) ON CONFLICT(userId, scope, key) DO UPDATE SET value = excluded.value`, [userId, provider, stringifyJson(models || {})]);
    }
  });

  return await exportDb();
}

// Eager init helper (optional)

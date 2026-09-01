// Public API barrel — all DB functions
import { getAdapter } from "./driver";
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
  statsEmitter, trackPendingRequest, getActiveRequests,
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
    providerConnections: (db.all(`SELECT * FROM providerConnections`) as Array<Record<string, unknown>>).map((r: Record<string, unknown>) => ({ ...(parseJson(r.data, {}) as Record<string, unknown>), id: r.id, provider: r.provider, authType: r.authType, name: r.name, email: r.email, priority: r.priority, isActive: r.isActive === 1, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    providerNodes: (db.all(`SELECT * FROM providerNodes`) as Array<Record<string, unknown>>).map((r: Record<string, unknown>) => ({ ...(parseJson(r.data, {}) as Record<string, unknown>), id: r.id, type: r.type, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    proxyPools: (db.all(`SELECT * FROM proxyPools`) as Array<Record<string, unknown>>).map((r: Record<string, unknown>) => ({ ...(parseJson(r.data, {}) as Record<string, unknown>), id: r.id, isActive: r.isActive === 1, testStatus: r.testStatus, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    apiKeys: (db.all(`SELECT * FROM apiKeys`) as Array<Record<string, unknown>>).map((r: Record<string, unknown>) => ({ id: r.id, key: r.key, name: r.name, machineId: r.machineId, isActive: r.isActive === 1, createdAt: r.createdAt })),
    combos: (db.all(`SELECT * FROM combos`) as Array<Record<string, unknown>>).map((r: Record<string, unknown>) => ({ id: r.id, name: r.name, kind: r.kind, models: parseJson(r.models, []), routing: parseJson(r.routing, null), createdAt: r.createdAt, updatedAt: r.updatedAt })),
    smartModelProfiles: (db.all(`SELECT * FROM smartModelProfiles`) as Array<Record<string, unknown>>).map((r: Record<string, unknown>) => ({
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
    modelAvailability: db.all(`SELECT * FROM modelAvailability`) as Array<Record<string, unknown>>,
    modelAliases: {} as Record<string, unknown>,
    customModels: [] as unknown[],
    pricing: {} as Record<string, unknown>,
  };

  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'modelAliases'`) as Array<Record<string, unknown>>) (out.modelAliases as Record<string, unknown>)[r.key as string] = parseJson(r.value);
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'customModels'`) as Array<Record<string, unknown>>) (out.customModels as unknown[]).push(parseJson(r.value));
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'pricing'`) as Array<Record<string, unknown>>) (out.pricing as Record<string, unknown>)[r.key as string] = parseJson(r.value);

  return out;
}

export async function importDb(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid database payload");
  }
  const db = await getAdapter();

  db.transaction(() => {
    // Wipe all tables (keep _meta)
    db.run(`DELETE FROM settings`);
    db.run(`DELETE FROM providerConnections`);
    db.run(`DELETE FROM providerNodes`);
    db.run(`DELETE FROM proxyPools`);
    db.run(`DELETE FROM apiKeys`);
    db.run(`DELETE FROM combos`);
    db.run(`DELETE FROM smartModelProfiles`);
    db.run(`DELETE FROM modelAvailability`);
    db.run(`DELETE FROM kv WHERE scope IN ('modelAliases', 'customModels', 'pricing')`);

    // Settings
    if (payload.settings) {
      db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [stringifyJson(payload.settings)]);
    }

    for (const c of (payload.providerConnections || []) as Array<Record<string, unknown>>) {
      const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
      db.run(
        `INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, provider, authType || "oauth", name || null, email || null, priority || null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const n of (payload.providerNodes || []) as Array<Record<string, unknown>>) {
      const { id, type, name, createdAt, updatedAt, ...rest } = n;
      db.run(
        `INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const p of (payload.proxyPools || []) as Array<Record<string, unknown>>) {
      const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
      db.run(
        `INSERT OR REPLACE INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const k of (payload.apiKeys || []) as Array<Record<string, unknown>>) {
      db.run(
        `INSERT OR REPLACE INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [k.id, k.key, k.name || null, k.machineId || null, k.isActive === false ? 0 : 1, k.createdAt || new Date().toISOString()]
      );
    }
    for (const c of (payload.combos || []) as Array<Record<string, unknown>>) {
      db.run(
        `INSERT OR REPLACE INTO combos(id, name, kind, models, routing, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
        [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.routing ? stringifyJson(c.routing) : null, c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
      );
    }
    for (const p of (payload.smartModelProfiles || []) as Array<Record<string, unknown>>) {
      db.run(
        `INSERT OR REPLACE INTO smartModelProfiles(modelKey, inventoryFingerprint, source, profile, classifierModel, sources, researchedAt, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.modelKey, p.inventoryFingerprint, p.source || "deterministic", stringifyJson(p.profile || {}), p.classifierModel || null, stringifyJson(p.sources || []), p.researchedAt || null, p.createdAt || new Date().toISOString(), p.updatedAt || new Date().toISOString()]
      );
    }
    for (const availability of (payload.modelAvailability || []) as Array<Record<string, unknown>>) {
      if (!availability.connectionId || !availability.modelId) continue;
      db.run(
        `INSERT OR REPLACE INTO modelAvailability(connectionId, modelId, status, reason, errorCode, lastError, until, createdAt, updatedAt)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
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
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('modelAliases', ?, ?)`, [a, stringifyJson(m)]);
    }
    for (const m of (payload.customModels || []) as Array<Record<string, unknown>>) {
      const k: string = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, stringifyJson(m)]);
    }
    for (const [provider, models] of Object.entries((payload.pricing || {}) as Record<string, unknown>)) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('pricing', ?, ?)`, [provider, stringifyJson(models || {})]);
    }
  });

  return await exportDb();
}

// Eager init helper (optional)

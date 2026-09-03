// ⚠️ AGENT/DEV: Bump this by +1 EVERY TIME you change the schema below
// (add/remove/alter a table, column, or index in TABLES). It drives the
// pre-change safety backup in migrate.js: when the stored version is lower,
// one lightweight DB backup is taken before applying schema changes. Forgetting
// to bump only skips that backup — it does NOT break the additive auto-sync.
export const SCHEMA_VERSION: number = 6;

export const PRAGMA_SQL: string = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 30000000;
PRAGMA cache_size = -64000;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
`;

interface TableDefinition {
  columns: Record<string, string>;
  primaryKey?: string;
  indexes?: string[];
}

// Declarative current schema. Used by syncSchemaFromTables() to
// auto-add missing tables/columns/indexes after versioned migrations.
// For destructive changes (drop/rename/type-change), write a migration file.
export const TABLES: Record<string, TableDefinition> = {
  _meta: {
    columns: {
      key: "TEXT PRIMARY KEY",
      value: "TEXT NOT NULL",
    },
  },
  settings: {
    columns: {
      id: "INTEGER PRIMARY KEY CHECK (id = 1)",
      data: "TEXT NOT NULL",
    },
  },
  providerConnections: {
    columns: {
      id: "TEXT PRIMARY KEY",
      provider: "TEXT NOT NULL",
      authType: "TEXT NOT NULL",
      name: "TEXT",
      email: "TEXT",
      priority: "INTEGER",
      isActive: "INTEGER DEFAULT 1",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pc_provider ON providerConnections(provider)",
      "CREATE INDEX IF NOT EXISTS idx_pc_provider_active ON providerConnections(provider, isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pc_priority ON providerConnections(provider, priority)",
    ],
  },
  providerNodes: {
    columns: {
      id: "TEXT PRIMARY KEY",
      type: "TEXT",
      name: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_pn_type ON providerNodes(type)"],
  },
  proxyPools: {
    columns: {
      id: "TEXT PRIMARY KEY",
      isActive: "INTEGER DEFAULT 1",
      testStatus: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pp_active ON proxyPools(isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pp_status ON proxyPools(testStatus)",
    ],
  },
  apiKeys: {
    columns: {
      id: "TEXT PRIMARY KEY",
      key: "TEXT UNIQUE NOT NULL",
      name: "TEXT",
      machineId: "TEXT",
      isActive: "INTEGER DEFAULT 1",
      createdAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_ak_key ON apiKeys(key)"],
  },
  combos: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT UNIQUE NOT NULL",
      kind: "TEXT",
      models: "TEXT NOT NULL",
      routing: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_combo_name ON combos(name)"],
  },
  smartModelProfiles: {
    columns: {
      modelKey: "TEXT PRIMARY KEY",
      inventoryFingerprint: "TEXT NOT NULL",
      source: "TEXT NOT NULL",
      profile: "TEXT NOT NULL",
      classifierModel: "TEXT",
      sources: "TEXT",
      researchedAt: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_smp_source ON smartModelProfiles(source)",
      "CREATE INDEX IF NOT EXISTS idx_smp_updated ON smartModelProfiles(updatedAt DESC)",
    ],
  },
  modelAvailability: {
    columns: {
      connectionId: "TEXT NOT NULL",
      modelId: "TEXT NOT NULL",
      status: "TEXT NOT NULL",
      reason: "TEXT NOT NULL",
      errorCode: "INTEGER",
      lastError: "TEXT",
      until: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (connectionId, modelId)",
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_ma_connection_until ON modelAvailability(connectionId, until)",
      "CREATE INDEX IF NOT EXISTS idx_ma_until ON modelAvailability(until)",
    ],
  },
  kv: {
    columns: {
      scope: "TEXT NOT NULL",
      key: "TEXT NOT NULL",
      value: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (scope, key)",
    indexes: ["CREATE INDEX IF NOT EXISTS idx_kv_scope ON kv(scope)"],
  },
  usageHistory: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      apiKey: "TEXT",
      endpoint: "TEXT",
      promptTokens: "INTEGER DEFAULT 0",
      completionTokens: "INTEGER DEFAULT 0",
      cost: "REAL DEFAULT 0",
      status: "TEXT",
      tokens: "TEXT",
      meta: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_uh_ts ON usageHistory(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_uh_provider ON usageHistory(provider)",
      "CREATE INDEX IF NOT EXISTS idx_uh_model ON usageHistory(model)",
      "CREATE INDEX IF NOT EXISTS idx_uh_conn ON usageHistory(connectionId)",
    ],
  },
  usageDaily: {
    columns: {
      dateKey: "TEXT PRIMARY KEY",
      data: "TEXT NOT NULL",
    },
  },
  requestDetails: {
    columns: {
      id: "TEXT PRIMARY KEY",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      status: "TEXT",
      data: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_rd_ts ON requestDetails(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_rd_provider ON requestDetails(provider)",
      "CREATE INDEX IF NOT EXISTS idx_rd_model ON requestDetails(model)",
      "CREATE INDEX IF NOT EXISTS idx_rd_conn ON requestDetails(connectionId)",
    ],
  },
  cloudConnections: {
    columns: {
      id: "TEXT PRIMARY KEY",
      provider: "TEXT NOT NULL",
      label: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_cc_provider ON cloudConnections(provider)",
    ],
  },
  cloudDeployments: {
    columns: {
      id: "TEXT PRIMARY KEY",
      connectionId: "TEXT NOT NULL",
      provider: "TEXT NOT NULL",
      toolId: "TEXT NOT NULL",
      status: "TEXT NOT NULL",
      publicUrl: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_cd_connection ON cloudDeployments(connectionId)",
      "CREATE INDEX IF NOT EXISTS idx_cd_tool ON cloudDeployments(toolId)",
      "CREATE INDEX IF NOT EXISTS idx_cd_status ON cloudDeployments(status)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_cd_tool_provider_active ON cloudDeployments(toolId, provider) WHERE status != 'failed'",
    ],
  },
  harnessConversations: {
    columns: {
      id: "TEXT PRIMARY KEY",
      title: "TEXT NOT NULL",
      projectId: "TEXT",
      providerId: "TEXT",
      modelId: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_hc_updated ON harnessConversations(updatedAt DESC)",
      "CREATE INDEX IF NOT EXISTS idx_hc_project ON harnessConversations(projectId)",
    ],
  },
  harnessEvents: {
    columns: {
      sessionId: "TEXT NOT NULL",
      seq: "INTEGER NOT NULL",
      type: "TEXT NOT NULL",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (sessionId, seq)",
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_he_session_seq ON harnessEvents(sessionId, seq)",
      "CREATE INDEX IF NOT EXISTS idx_he_type ON harnessEvents(type)",
    ],
  },
  // Patch layer over the plugin rows each bundle declares in code. An empty
  // table reproduces the bundle defaults exactly, so this ships inert.
  // See docs/superpowers/specs/2026-09-02-db-plugin-system-design.md.
  pluginRows: {
    columns: {
      id: "TEXT PRIMARY KEY",
      plugin: "TEXT NOT NULL",
      config: "TEXT NOT NULL",
      position: "INTEGER NOT NULL",
      enabled: "INTEGER NOT NULL DEFAULT 1",
      source: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_pr_position ON pluginRows(position)"],
  },
  // User and override layer for bundled agent skills. Empty table = bundle defaults.
  agentSkills: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT NOT NULL",
      description: "TEXT NOT NULL",
      body: "TEXT NOT NULL",
      enabled: "INTEGER NOT NULL DEFAULT 1",
      source: "TEXT NOT NULL",
      origin: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_as_enabled ON agentSkills(enabled)"],
  },
  agentSkillFiles: {
    columns: {
      skillId: "TEXT NOT NULL",
      filePath: "TEXT NOT NULL",
      content: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (skillId, filePath)",
    indexes: ["CREATE INDEX IF NOT EXISTS idx_asf_skill ON agentSkillFiles(skillId)"],
  },
  agentMemoryEntries: {
    columns: {
      id: "TEXT PRIMARY KEY",
      scope: "TEXT NOT NULL",
      content: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_ame_scope ON agentMemoryEntries(scope)"],
  },
  harnessPendingWrites: {
    columns: {
      id: "TEXT PRIMARY KEY",
      kind: "TEXT NOT NULL",
      action: "TEXT NOT NULL",
      payload: "TEXT NOT NULL",
      source: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_hpw_kind ON harnessPendingWrites(kind)"],
  },
  harnessMessageIndex: {
    columns: {
      sessionId: "TEXT NOT NULL",
      messageId: "TEXT NOT NULL",
      role: "TEXT NOT NULL",
      content: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (sessionId, messageId)",
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_hmi_created ON harnessMessageIndex(createdAt DESC)",
    ],
  },
};

export function buildCreateTableSql(name: string, def: TableDefinition): string {
  const cols: string[] = Object.entries(def.columns).map(([k, v]) => `${k} ${v}`);
  if (def.primaryKey) cols.push(def.primaryKey);
  return `CREATE TABLE IF NOT EXISTS ${name} (${cols.join(", ")})`;
}

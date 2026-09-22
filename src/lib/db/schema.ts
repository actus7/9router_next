// Declarative current schema for Neon Postgres. `syncSchema()` in migrate.ts
// reads it and adds missing tables, columns and indexes on boot — there is no
// versioned migration chain any more. For a destructive change (drop, rename,
// type change) run the DDL against the Neon branch by hand, then update this
// file; the sync is additive and will not do it for you.

interface TableDefinition {
  columns: Record<string, string>;
  primaryKey?: string;
  indexes?: string[];
}

/**
 * Every table but `_meta` carries `userId`: the Neon Auth user that owns the
 * row. `_meta` is instance state, not tenant state.
 *
 * Where a table's key was already a surrogate uuid, `userId` is a plain column
 * and the primary key is unchanged — a uuid does not collide between tenants.
 * Where the key was *natural* or caller-supplied it joins the primary key,
 * because those values genuinely repeat across tenants: `kv(scope, key)`,
 * `usageDaily(dateKey)`, the `noauth:<provider>` synthetic ids in
 * `modelAvailability`, and the bundle-declared ids that `agentSkills` and
 * `pluginRows` patch. Getting that distinction wrong is a second tenant's
 * insert failing on someone else's primary key, so it is decided per table
 * rather than by a rule.
 *
 * Identifiers stay unquoted. Postgres folds them to lowercase consistently in
 * DDL and in queries, so `WHERE machineId = ?` keeps working; the adapter puts
 * the case back on the way out.
 */
export const TABLES: Record<string, TableDefinition> = {
  _meta: {
    columns: {
      key: "TEXT PRIMARY KEY",
      value: "TEXT NOT NULL",
    },
  },
  // One row per tenant. The old single row (`id = 1`, one operator) is gone.
  settings: {
    columns: {
      userId: "TEXT PRIMARY KEY",
      data: "TEXT NOT NULL",
    },
  },
  providerConnections: {
    columns: {
      id: "TEXT PRIMARY KEY",
      userId: "TEXT NOT NULL",
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
      "CREATE INDEX IF NOT EXISTS idx_pc_provider ON providerConnections(userId, provider)",
      "CREATE INDEX IF NOT EXISTS idx_pc_provider_active ON providerConnections(userId, provider, isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pc_priority ON providerConnections(userId, provider, priority)",
    ],
  },
  providerNodes: {
    columns: {
      id: "TEXT PRIMARY KEY",
      userId: "TEXT NOT NULL",
      type: "TEXT",
      name: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_pn_type ON providerNodes(userId, type)"],
  },
  proxyPools: {
    columns: {
      id: "TEXT PRIMARY KEY",
      userId: "TEXT NOT NULL",
      isActive: "INTEGER DEFAULT 1",
      testStatus: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pp_active ON proxyPools(userId, isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pp_status ON proxyPools(userId, testStatus)",
    ],
  },
  // One key per destination. The same key used to be written to every CLI
  // config file, pushed as a cloud env var and handed to the user, with no
  // record of where it went — so there was no way to rotate one without
  // breaking the rest. `sink` names the destination and `sinkRef` locates it,
  // which makes the inventory a query and revocation per-destination.
  //
  // `key` stays UNIQUE across the whole table, not per tenant: it is the
  // gateway's only credential, and the tenant is resolved *from* it. Two
  // tenants sharing a key value would make that lookup ambiguous.
  apiKeys: {
    columns: {
      id: "TEXT PRIMARY KEY",
      userId: "TEXT NOT NULL",
      key: "TEXT UNIQUE NOT NULL",
      name: "TEXT",
      machineId: "TEXT",
      isActive: "INTEGER DEFAULT 1",
      createdAt: "TEXT NOT NULL",
      // "manual" | "dashboard" | "cli:<toolId>" | "cloud:<provider>".
      // NULL on rows that predate this column, read as "manual".
      sink: "TEXT",
      // Where the key landed: a config file path, or a deployment id.
      sinkRef: "TEXT",
      // Audit timestamp. `isActive` stays the gate `validateApiKey` reads, so a
      // revoked row keeps its usage history resolvable instead of vanishing.
      revokedAt: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_ak_key ON apiKeys(key)",
      "CREATE INDEX IF NOT EXISTS idx_ak_sink ON apiKeys(userId, sink)",
    ],
  },
  combos: {
    columns: {
      id: "TEXT PRIMARY KEY",
      userId: "TEXT NOT NULL",
      name: "TEXT NOT NULL",
      kind: "TEXT",
      models: "TEXT NOT NULL",
      routing: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE UNIQUE INDEX IF NOT EXISTS idx_combo_name ON combos(userId, name)"],
  },
  smartModelProfiles: {
    columns: {
      userId: "TEXT NOT NULL",
      modelKey: "TEXT NOT NULL",
      inventoryFingerprint: "TEXT NOT NULL",
      source: "TEXT NOT NULL",
      profile: "TEXT NOT NULL",
      classifierModel: "TEXT",
      sources: "TEXT",
      researchedAt: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (userId, modelKey)",
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_smp_source ON smartModelProfiles(userId, source)",
      "CREATE INDEX IF NOT EXISTS idx_smp_updated ON smartModelProfiles(userId, updatedAt DESC)",
    ],
  },
  // Do NOT add a FOREIGN KEY on connectionId. noAuth providers have no
  // connection row and store their provider-wide cooldown here under the
  // synthetic id `noauth:<provider>` (see application/noAuthCooldown.ts), so a
  // constraint would reject those inserts. That same synthetic id is what puts
  // `userId` in the primary key: it repeats across tenants by construction.
  // `deleteProviderConnection` clears its children explicitly instead; the
  // policy for every parent/child pair is asserted in
  // tests/unit/childRowDeletePolicy.test.ts.
  modelAvailability: {
    columns: {
      userId: "TEXT NOT NULL",
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
    primaryKey: "PRIMARY KEY (userId, connectionId, modelId)",
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_ma_connection_until ON modelAvailability(userId, connectionId, until)",
      "CREATE INDEX IF NOT EXISTS idx_ma_until ON modelAvailability(userId, until)",
    ],
  },
  kv: {
    columns: {
      userId: "TEXT NOT NULL",
      scope: "TEXT NOT NULL",
      key: "TEXT NOT NULL",
      value: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (userId, scope, key)",
    indexes: ["CREATE INDEX IF NOT EXISTS idx_kv_scope ON kv(userId, scope)"],
  },
  usageHistory: {
    columns: {
      id: "BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY",
      userId: "TEXT NOT NULL",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      apiKey: "TEXT",
      endpoint: "TEXT",
      promptTokens: "INTEGER DEFAULT 0",
      completionTokens: "INTEGER DEFAULT 0",
      // DOUBLE PRECISION, not REAL: REAL is float4 in Postgres (~7 significant
      // digits) where SQLite's REAL was a double, and per-request costs run to
      // six decimal places before they are summed.
      cost: "DOUBLE PRECISION DEFAULT 0",
      status: "TEXT",
      tokens: "TEXT",
      meta: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_uh_ts ON usageHistory(userId, timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_uh_provider ON usageHistory(userId, provider)",
      "CREATE INDEX IF NOT EXISTS idx_uh_model ON usageHistory(userId, model)",
      "CREATE INDEX IF NOT EXISTS idx_uh_conn ON usageHistory(userId, connectionId)",
    ],
  },
  usageDaily: {
    columns: {
      userId: "TEXT NOT NULL",
      dateKey: "TEXT NOT NULL",
      data: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (userId, dateKey)",
  },
  requestDetails: {
    columns: {
      id: "TEXT PRIMARY KEY",
      userId: "TEXT NOT NULL",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      status: "TEXT",
      data: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_rd_ts ON requestDetails(userId, timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_rd_provider ON requestDetails(userId, provider)",
      "CREATE INDEX IF NOT EXISTS idx_rd_model ON requestDetails(userId, model)",
      "CREATE INDEX IF NOT EXISTS idx_rd_conn ON requestDetails(userId, connectionId)",
    ],
  },
  cloudConnections: {
    columns: {
      id: "TEXT PRIMARY KEY",
      userId: "TEXT NOT NULL",
      provider: "TEXT NOT NULL",
      label: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_cc_provider ON cloudConnections(userId, provider)",
    ],
  },
  cloudDeployments: {
    columns: {
      id: "TEXT PRIMARY KEY",
      userId: "TEXT NOT NULL",
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
      "CREATE INDEX IF NOT EXISTS idx_cd_connection ON cloudDeployments(userId, connectionId)",
      "CREATE INDEX IF NOT EXISTS idx_cd_tool ON cloudDeployments(userId, toolId)",
      "CREATE INDEX IF NOT EXISTS idx_cd_status ON cloudDeployments(userId, status)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_cd_tool_provider_active ON cloudDeployments(userId, toolId, provider) WHERE status != 'failed'",
    ],
  },
  // The only per-conversation table whose id used to be a *global* primary
  // key, so one account could hold an id another account needed — and the
  // upsert that matched nothing took the whole sync down with it. Keyed like
  // `harnessEvents`, `agentSkills` and the rest now.
  //
  // The unique index is what the upsert conflicts on. It is declared
  // separately so it exists on databases created before the key changed:
  // `syncSchema` adds indexes to an existing table but never rewrites its
  // primary key, and the swap for those is DDL run by hand.
  harnessConversations: {
    columns: {
      id: "TEXT NOT NULL",
      userId: "TEXT NOT NULL",
      title: "TEXT NOT NULL",
      projectId: "TEXT",
      providerId: "TEXT",
      modelId: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (userId, id)",
    indexes: [
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_hc_owner_id ON harnessConversations(userId, id)",
      "CREATE INDEX IF NOT EXISTS idx_hc_updated ON harnessConversations(userId, updatedAt DESC)",
      "CREATE INDEX IF NOT EXISTS idx_hc_project ON harnessConversations(userId, projectId)",
    ],
  },
  // Conversations this account deleted, so the deletion converges.
  //
  // Sync is per-device and additive: a client that still holds a conversation
  // locally re-uploads it, because "absent from the server" and "never synced"
  // look identical from there. Deleting on the desktop therefore un-deleted
  // itself the next time the phone opened the chat. A tombstone is the missing
  // third state, and it is what `GET /api/harness/sessions` reports so every
  // device can drop what is gone.
  //
  // Kept for `DELETED_CONVERSATION_TTL_MS`, which only has to outlast the
  // longest a device can plausibly stay offline holding a stale copy.
  harnessDeletedConversations: {
    columns: {
      userId: "TEXT NOT NULL",
      id: "TEXT NOT NULL",
      deletedAt: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (userId, id)",
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_hdc_deletedAt ON harnessDeletedConversations(userId, deletedAt)",
    ],
  },
  harnessEvents: {
    columns: {
      userId: "TEXT NOT NULL",
      sessionId: "TEXT NOT NULL",
      seq: "INTEGER NOT NULL",
      type: "TEXT NOT NULL",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (userId, sessionId, seq)",
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_he_type ON harnessEvents(userId, type)",
    ],
  },
  // A chat run that outlives the browser tab that started it.
  //
  // The run is the durable half of a send: the worker writes `partialText` as
  // the provider streams and settles `status` at the end, so closing the tab
  // or the laptop stops nothing. It is deliberately NOT written into
  // `harnessConversations` by the server — that table is replaced wholesale by
  // the client's `PUT /api/harness/sessions`, and a background write racing a
  // full replace loses. The client reconciles finished runs into the
  // conversation the next time it opens the session.
  harnessRuns: {
    columns: {
      id: "TEXT PRIMARY KEY",
      userId: "TEXT NOT NULL",
      sessionId: "TEXT NOT NULL",
      messageId: "TEXT NOT NULL",
      status: "TEXT NOT NULL",
      model: "TEXT",
      // The coarse stage the worker is in, for the history list. Nullable and
      // never read back by the run itself: purely what to say about it.
      activity: "TEXT",
      partialText: "TEXT NOT NULL",
      reasoning: "TEXT",
      toolCalls: "TEXT",
      usage: "TEXT",
      error: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_hr_session ON harnessRuns(userId, sessionId, createdAt DESC)",
      "CREATE INDEX IF NOT EXISTS idx_hr_status ON harnessRuns(userId, status, updatedAt)",
    ],
  },
  // Patch layer over the plugin rows each bundle declares in code. An empty
  // table reproduces the bundle defaults exactly, so this ships inert.
  // `id` is the bundle's row id, identical for every tenant that overrides the
  // same row — hence the composite key.
  // See docs/superpowers/specs/2026-09-02-db-plugin-system-design.md.
  pluginRows: {
    columns: {
      userId: "TEXT NOT NULL",
      id: "TEXT NOT NULL",
      plugin: "TEXT NOT NULL",
      config: "TEXT NOT NULL",
      position: "INTEGER NOT NULL",
      enabled: "INTEGER NOT NULL DEFAULT 1",
      source: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (userId, id)",
    indexes: ["CREATE INDEX IF NOT EXISTS idx_pr_position ON pluginRows(userId, position)"],
  },
  // User and override layer for bundled agent skills. Empty table = bundle
  // defaults, and an override reuses the bundled skill's id — so, like
  // pluginRows, the id is only unique within a tenant.
  agentSkills: {
    columns: {
      userId: "TEXT NOT NULL",
      id: "TEXT NOT NULL",
      name: "TEXT NOT NULL",
      description: "TEXT NOT NULL",
      body: "TEXT NOT NULL",
      enabled: "INTEGER NOT NULL DEFAULT 1",
      source: "TEXT NOT NULL",
      origin: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (userId, id)",
    indexes: ["CREATE INDEX IF NOT EXISTS idx_as_enabled ON agentSkills(userId, enabled)"],
  },
  agentSkillFiles: {
    columns: {
      userId: "TEXT NOT NULL",
      skillId: "TEXT NOT NULL",
      filePath: "TEXT NOT NULL",
      content: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (userId, skillId, filePath)",
  },
  agentMemoryEntries: {
    columns: {
      id: "TEXT PRIMARY KEY",
      userId: "TEXT NOT NULL",
      scope: "TEXT NOT NULL",
      content: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_ame_scope ON agentMemoryEntries(userId, scope)"],
  },
  harnessPendingWrites: {
    columns: {
      id: "TEXT PRIMARY KEY",
      userId: "TEXT NOT NULL",
      kind: "TEXT NOT NULL",
      action: "TEXT NOT NULL",
      payload: "TEXT NOT NULL",
      source: "TEXT NOT NULL",
      status: "TEXT NOT NULL DEFAULT 'pending'",
      reviewedAt: "TEXT",
      result: "TEXT",
      // Jev's risk read of the write, when the account runs Jev. Advisory only.
      risk: "TEXT",
      createdAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_hpw_kind ON harnessPendingWrites(userId, kind)",
      "CREATE INDEX IF NOT EXISTS idx_hpw_status_created ON harnessPendingWrites(userId, status, createdAt)",
    ],
  },
  // Full-text search over past sessions. SQLite kept a second FTS5 virtual
  // table in sync by hand; Postgres derives the index from `content` itself, so
  // there is no second table to write to and no way for the two to drift.
  harnessMessageIndex: {
    columns: {
      userId: "TEXT NOT NULL",
      sessionId: "TEXT NOT NULL",
      messageId: "TEXT NOT NULL",
      role: "TEXT NOT NULL",
      content: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      contentTsv: "tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED",
    },
    primaryKey: "PRIMARY KEY (userId, sessionId, messageId)",
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_hmi_created ON harnessMessageIndex(userId, createdAt DESC)",
      "CREATE INDEX IF NOT EXISTS idx_hmi_tsv ON harnessMessageIndex USING GIN (contentTsv)",
    ],
  },
};

/** Tables whose every row belongs to one tenant. `_meta` is the only exception. */
export const TENANT_TABLES: readonly string[] = Object.keys(TABLES).filter((t) => t !== "_meta");

export function buildCreateTableSql(name: string, def: TableDefinition): string {
  const cols: string[] = Object.entries(def.columns).map(([k, v]) => `${k} ${v}`);
  if (def.primaryKey) cols.push(def.primaryKey);
  return `CREATE TABLE IF NOT EXISTS ${name} (${cols.join(", ")})`;
}

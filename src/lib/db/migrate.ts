import fs from "node:fs";
import path from "node:path";
import { LEGACY_FILES, DB_DIR } from "./paths";
import { TABLES, buildCreateTableSql, SCHEMA_VERSION } from "./schema";
import { MIGRATIONS, latestVersion } from "./migrations/index";
import { getMetaSync, setMetaSync } from "./helpers/metaStore";
import { makeBackupDir, backupFile, backupDbLite, pruneOldBackups } from "./backup";
import { getAppVersion } from "./version";
import { stringifyJson } from "./helpers/jsonCol";

// Marker file: prevents re-importing legacy JSON when user wipes data.sqlite.
const MIGRATED_MARKER: string = path.join(DB_DIR, ".migrated-from-json");

// Track per-adapter so reusing same adapter skips re-run, but new adapter (after reset) re-runs.
const _migratedAdapters: WeakSet<object> = new WeakSet();

interface DbAdapter {
  get(sql: string, params?: unknown[]): Record<string, unknown> | undefined;
  all(sql: string, params?: unknown[]): Array<Record<string, unknown>>;
  run(sql: string, params?: unknown[]): { changes: number; lastInsertRowid: number | null };
  exec(sql: string): void;
  transaction(fn: () => void): void;
}

interface Migration {
  version: number;
  name: string;
  up(db: DbAdapter): void;
}

interface DroppedRow {
  [key: string]: unknown;
  reason: string;
}

// Thrown when row-count assertion fails. Outer transaction rolls back,
// legacy db.json kept intact, marker not written → next boot retries.
class MigrationAborted extends Error {
  droppedRows: DroppedRow[];
  constructor(message: string, droppedRows: DroppedRow[]) {
    super(message);
    this.name = "MigrationAborted";
    this.droppedRows = droppedRows;
  }
}

// Insert rows one-by-one, collect failures, then assert COUNT(*) matches input length.
function importWithAssertion(
  adapter: DbAdapter,
  tableName: string,
  rows: Array<Record<string, unknown>>,
  insertFn: (row: Record<string, unknown>) => void,
  rowMeta: (row: Record<string, unknown>) => Record<string, unknown>
): void {
  const dropped: DroppedRow[] = [];
  for (const row of rows) {
    try { insertFn(row); }
    catch (err: any) { dropped.push({ ...rowMeta(row), reason: err.message }); }
  }
  const inserted: number = (adapter.get(`SELECT COUNT(*) as c FROM ${tableName}`)?.c as number) ?? 0;
  if (inserted !== rows.length) {
    console.warn(`[DB][migrate] ${tableName} row-count mismatch: expected ${rows.length}, got ${inserted}. Dropped:`, dropped);
    throw new MigrationAborted(`${tableName} row-count mismatch: expected ${rows.length}, got ${inserted}`, dropped);
  }
}

function readJsonSafe(file: string): Record<string, unknown> | null {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return null; }
}

function isFreshDb(adapter: DbAdapter): boolean {
  // Table _meta may not exist yet on truly fresh DB
  try {
    const row: Record<string, unknown> | undefined = adapter.get(`SELECT COUNT(*) as c FROM _meta`);
    return !row || row.c === 0;
  } catch {
    return true;
  }
}

// ─── Versioned migrations runner (skip-version safe) ─────────────────────
function runVersionedMigrations(adapter: DbAdapter): { applied: number; from: number; to: number } {
  // Bootstrap _meta first so we can read schemaVersion
  adapter.exec(buildCreateTableSql("_meta", TABLES._meta));

  const current: number = parseInt(getMetaSync(adapter, "schemaVersion", "0"), 10) || 0;
  const target: number = latestVersion();
  if (current >= target) return { applied: 0, from: current, to: current };

  const pending: Migration[] = MIGRATIONS.filter((m: Migration) => m.version > current);
  let lastApplied: number = current;
  for (const m of pending) {
    adapter.transaction(() => {
      m.up(adapter);
      setMetaSync(adapter, "schemaVersion", m.version);
    });
    lastApplied = m.version;
    console.log(`[DB][migrate] applied #${m.version} ${m.name}`);
  }
  return { applied: pending.length, from: current, to: lastApplied };
}

// ─── Auto-sync (additive only): add missing tables/columns/indexes ───────
function syncSchemaFromTables(adapter: DbAdapter): void {
  for (const [tableName, def] of Object.entries(TABLES)) {
    // Create table if absent
    adapter.exec(buildCreateTableSql(tableName, def));

    // Diff columns
    const existing: Array<{ name: string }> = adapter.all(`PRAGMA table_info(${tableName})`);
    const existingNames: Set<string> = new Set(existing.map((r: { name: string }) => r.name));
    for (const [colName, colDef] of Object.entries(def.columns)) {
      if (!existingNames.has(colName)) {
        // SQLite ADD COLUMN restrictions: no PRIMARY KEY / UNIQUE w/o NULL ok.
        // We strip PRIMARY KEY / UNIQUE since those are only valid at create time.
        const safeDef: string = colDef
          .replace(/PRIMARY KEY( AUTOINCREMENT)?/i, "")
          .replace(/UNIQUE/i, "")
          .trim();
        try {
          adapter.exec(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${safeDef}`);
          console.log(`[DB][sync] +column ${tableName}.${colName}`);
        } catch (e: any) {
          console.warn(`[DB][sync] add column ${tableName}.${colName} failed: ${e.message}`);
        }
      }
    }

    // Indexes (idempotent)
    for (const idx of def.indexes || []) {
      try { adapter.exec(idx); } catch {}
    }
  }
}

// ─── Legacy JSON import (one-time) ───────────────────────────────────────
function importLegacyMain(adapter: DbAdapter, data: Record<string, unknown> | null): void {
  if (!data || typeof data !== "object") return;

  if (data.settings) {
    adapter.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [stringifyJson(data.settings)]);
  }

  importWithAssertion(adapter, "providerConnections", (data.providerConnections || []) as Array<Record<string, unknown>>, (c: Record<string, unknown>) => {
    const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c as Record<string, unknown>;
    adapter.run(
      `INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, provider, authType || "oauth", name || null, email || null, priority || null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
    );
  }, (c: Record<string, unknown>) => ({ id: c.id ?? null, provider: c.provider ?? null, name: c.name ?? null }));

  importWithAssertion(adapter, "providerNodes", (data.providerNodes || []) as Array<Record<string, unknown>>, (n: Record<string, unknown>) => {
    const { id, type, name, createdAt, updatedAt, ...rest } = n as Record<string, unknown>;
    adapter.run(
      `INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [id, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
    );
  }, (n: Record<string, unknown>) => ({ id: n.id ?? null, type: n.type ?? null, name: n.name ?? null }));

  importWithAssertion(adapter, "proxyPools", (data.proxyPools || []) as Array<Record<string, unknown>>, (p: Record<string, unknown>) => {
    const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p as Record<string, unknown>;
    adapter.run(
      `INSERT OR REPLACE INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [id, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
    );
  }, (p: Record<string, unknown>) => ({ id: p.id ?? null }));

  importWithAssertion(adapter, "apiKeys", (data.apiKeys || []) as Array<Record<string, unknown>>, (k: Record<string, unknown>) => {
    adapter.run(
      `INSERT OR REPLACE INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [k.id, k.key, k.name || null, k.machineId || null, k.isActive === false ? 0 : 1, k.createdAt || new Date().toISOString()]
    );
  }, (k: Record<string, unknown>) => ({ id: k.id ?? null, name: k.name ?? null }));

  importWithAssertion(adapter, "combos", (data.combos || []) as Array<Record<string, unknown>>, (c: Record<string, unknown>) => {
    adapter.run(
      `INSERT OR REPLACE INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
    );
  }, (c: Record<string, unknown>) => ({ id: c.id ?? null, name: c.name ?? null }));

  for (const [alias, model] of Object.entries((data.modelAliases || {}) as Record<string, unknown>)) {
    adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('modelAliases', ?, ?)`, [alias, stringifyJson(model)]);
  }
  for (const m of (data.customModels || []) as Array<Record<string, unknown>>) {
    const k: string = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
    adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, stringifyJson(m)]);
  }
  for (const [tool, mappings] of Object.entries((data.mitmAlias || {}) as Record<string, unknown>)) {
    adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('mitmAlias', ?, ?)`, [tool, stringifyJson(mappings || {})]);
  }
  for (const [provider, models] of Object.entries((data.pricing || {}) as Record<string, unknown>)) {
    adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('pricing', ?, ?)`, [provider, stringifyJson(models || {})]);
  }
}

function importLegacyUsage(adapter: DbAdapter, data: Record<string, unknown> | null): void {
  if (!data || typeof data !== "object") return;
  for (const e of ((data.history || []) as Array<Record<string, unknown>>)) {
    const t: Record<string, unknown> = (e.tokens || {}) as Record<string, unknown>;
    adapter.run(
      `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        e.timestamp || new Date().toISOString(),
        e.provider || null, e.model || null, e.connectionId || null, e.apiKey || null, e.endpoint || null,
        t.prompt_tokens || t.input_tokens || 0,
        t.completion_tokens || t.output_tokens || 0,
        e.cost || 0,
        e.status || "ok",
        stringifyJson(t),
        stringifyJson({}),
      ]
    );
  }
  for (const [dateKey, day] of Object.entries((data.dailySummary || {}) as Record<string, unknown>)) {
    adapter.run(`INSERT OR REPLACE INTO usageDaily(dateKey, data) VALUES(?, ?)`, [dateKey, stringifyJson(day)]);
  }
  if (typeof data.totalRequestsLifetime === "number") {
    setMetaSync(adapter, "totalRequestsLifetime", data.totalRequestsLifetime);
  }
}

function importLegacyDisabled(adapter: DbAdapter, data: Record<string, unknown> | null): void {
  if (!data || typeof data.disabled !== "object") return;
  for (const [provider, ids] of Object.entries(data.disabled as Record<string, unknown>)) {
    adapter.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('disabledModels', ?, ?)`, [provider, stringifyJson(ids || [])]);
  }
}

function importLegacyDetails(adapter: DbAdapter, data: Record<string, unknown> | null): void {
  if (!data || !Array.isArray(data.records)) return;
  for (const r of data.records as Array<Record<string, unknown>>) {
    adapter.run(
      `INSERT OR REPLACE INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)`,
      [r.id, r.timestamp || new Date().toISOString(), r.provider || null, r.model || null, r.connectionId || null, r.status || null, stringifyJson(r)]
    );
  }
}

// ─── Main entry ──────────────────────────────────────────────────────────
export async function runMigrationOnce(adapter: DbAdapter): Promise<void> {
  if (_migratedAdapters.has(adapter)) return;
  _migratedAdapters.add(adapter);

  // Capture freshness BEFORE migrations stamp _meta (otherwise we'd misclassify
  // a brand-new DB as non-fresh once schemaVersion is written).
  const fresh: boolean = isFreshDb(adapter);

  // Prune stale backups every boot so old oversized backups shrink to KEEP.
  pruneOldBackups();

  // Bootstrap _meta so we can read the stored backup schema version below
  // (runVersionedMigrations also ensures this, but we need it earlier here).
  adapter.exec(buildCreateTableSql("_meta", TABLES._meta));

  // Detect a pending schema change via the central SCHEMA_VERSION const.
  // A lightweight backup is taken BEFORE any schema mutation below.
  const storedSchemaVer: number = parseInt(getMetaSync(adapter, "backupSchemaVersion", "0"), 10) || 0;
  const schemaChanging: boolean = !fresh && storedSchemaVer < SCHEMA_VERSION;
  if (schemaChanging) {
    try {
      const backupDir: string = makeBackupDir(`schema-${storedSchemaVer}-to-${SCHEMA_VERSION}`);
      backupDbLite(adapter, backupDir);
      pruneOldBackups();
      console.log(`[DB][migrate] pre-schema backup ${storedSchemaVer} → ${SCHEMA_VERSION}: ${backupDir}`);
    } catch (e: any) {
      console.warn(`[DB][migrate] pre-schema backup failed (continuing): ${e.message}`);
    }
  }

  // 1. Always run versioned migrations chain (skip-version safe)
  const migInfo: { applied: number; from: number; to: number } = runVersionedMigrations(adapter);

  // 2. Additive sync (auto add missing columns/indexes declared in TABLES)
  syncSchemaFromTables(adapter);

  // Stamp the schema version we just reached so future boots skip re-backup.
  setMetaSync(adapter, "backupSchemaVersion", SCHEMA_VERSION);

  // 3. One-time legacy JSON import (only if DB was fresh on entry)
  const alreadyImported: boolean = fs.existsSync(MIGRATED_MARKER);
  const legacyMain: Record<string, unknown> | null = readJsonSafe(LEGACY_FILES.main);
  const legacyUsage: Record<string, unknown> | null = readJsonSafe(LEGACY_FILES.usage);
  const legacyDisabled: Record<string, unknown> | null = readJsonSafe(LEGACY_FILES.disabled);
  const legacyDetails: Record<string, unknown> | null = readJsonSafe(LEGACY_FILES.details);
  const hasLegacy: boolean = !!(legacyMain || legacyUsage || legacyDisabled || legacyDetails);

  if (fresh && hasLegacy && !alreadyImported) {
    const t0: number = Date.now();
    const backupDir: string = makeBackupDir("migrate-from-json");
    for (const f of Object.values(LEGACY_FILES)) backupFile(f, backupDir);

    try {
      adapter.transaction(() => {
        importLegacyMain(adapter, legacyMain);
        importLegacyUsage(adapter, legacyUsage);
        importLegacyDisabled(adapter, legacyDisabled);
        importLegacyDetails(adapter, legacyDetails);
        setMetaSync(adapter, "appVersion", getAppVersion());
        setMetaSync(adapter, "backupSchemaVersion", SCHEMA_VERSION);
        setMetaSync(adapter, "migratedAt", new Date().toISOString());
      });
    } catch (err: unknown) {
      if (err instanceof MigrationAborted) {
        console.error(`[DB][migrate] aborted: ${err.message} | legacy JSON kept | backup: ${backupDir}`);
        return;
      }
      throw err;
    }

    try { fs.writeFileSync(MIGRATED_MARKER, new Date().toISOString()); } catch {}
    pruneOldBackups();
    console.log(`[DB][migrate] JSON → SQLite in ${Date.now() - t0}ms | legacy JSON kept at DATA_DIR | backup: ${backupDir}`);
    return;
  }

  // Track app version for informational purposes only. App version bumps no
  // longer trigger a DB backup — only real schema changes (SCHEMA_VERSION) do.
  const newVer: string = getAppVersion();
  const oldVer: string | null = getMetaSync(adapter, "appVersion", null);
  if (oldVer !== newVer) setMetaSync(adapter, "appVersion", newVer);
}

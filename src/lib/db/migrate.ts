import { createHash } from "node:crypto";
import { TABLES, buildCreateTableSql } from "./schema";
import {
  assertCredentialEncryptionPolicy,
  isCredentialEncryptionEnabled,
} from "./helpers/credentialCipher";
import { getAppVersion } from "./version";
import type { DbAdapter } from "./driver";

// Track per-adapter so reusing the same adapter skips re-run, but a new adapter
// (after a reset) re-runs.
const _migratedAdapters: WeakSet<object> = new WeakSet();

/**
 * Brings the Neon database up to the schema declared in `schema.ts`.
 *
 * Additive only: it creates missing tables, adds missing columns and creates
 * missing indexes. There is no versioned migration chain — the SQLite one was
 * specific to a file-backed database that no longer exists, and Neon's own
 * branching covers the "undo a bad change" case that a chain used to.
 * A destructive change (drop, rename, retype) is run by hand against the
 * branch, then reflected here.
 */
/**
 * `CREATE TABLE IF NOT EXISTS` is not atomic against a concurrent one.
 *
 * Two Postgres sessions running it at the same instant both see the table
 * missing and both try to create it; the loser gets `23505 duplicate key value
 * violates unique constraint "pg_type_typname_nsp_index"`, not a quiet no-op.
 * That happens on every deploy, where several serverless instances cold-start
 * together — and it used to be the one DDL here outside a try/catch, so the
 * error escaped `initAdapter` and every route on that instance answered 500.
 *
 * A real failure still throws: the table is re-checked, and only an error that
 * left it existing is treated as the race it is.
 */
async function createTable(
  adapter: DbAdapter,
  tableName: string,
  def: (typeof TABLES)[keyof typeof TABLES],
): Promise<void> {
  try {
    await adapter.exec(buildCreateTableSql(tableName, def));
  } catch (e: unknown) {
    const exists = await adapter.get(
      `SELECT 1 AS present FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = ?`,
      [tableName.toLowerCase()],
    );
    if (!exists) throw e;
    console.warn(`[DB][sync] ${tableName} was created concurrently: ${(e as Error).message}`);
  }
}

/**
 * Fingerprint of what `syncSchema` would converge the database to.
 *
 * Hashes the generated CREATE statements alongside the declarations, so a
 * change to `buildCreateTableSql` counts as a schema change too.
 */
function schemaHash(): string {
  const declared = Object.entries(TABLES).map(([name, def]) => [buildCreateTableSql(name, def), def]);
  return createHash("sha256").update(JSON.stringify(declared)).digest("hex");
}

export const __test__ = { schemaHash };

/** @returns false when some DDL failed and the sync must be retried next boot. */
async function syncSchema(adapter: DbAdapter): Promise<boolean> {
  let clean: boolean = true;
  for (const [tableName, def] of Object.entries(TABLES)) {
    await createTable(adapter, tableName, def);

    // Postgres folds unquoted identifiers to lowercase, and the catalog stores
    // what was actually created — so the comparison has to be lowercase too.
    const existing = (await adapter.all(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = ?`,
      [tableName.toLowerCase()],
    )) as unknown as Array<{ column_name: string }>;
    const existingNames: Set<string> = new Set(existing.map((r) => r.column_name.toLowerCase()));

    for (const [colName, colDef] of Object.entries(def.columns)) {
      if (existingNames.has(colName.toLowerCase())) continue;
      // PRIMARY KEY and UNIQUE are only valid at create time; on an existing
      // table they are separate DDL. Strip them so the ADD COLUMN succeeds and
      // the index list below supplies the constraint where one is declared.
      const safeDef: string = colDef
        .replace(/PRIMARY KEY/i, "")
        .replace(/UNIQUE/i, "")
        .trim();
      try {
        await adapter.exec(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${safeDef}`);
        console.log(`[DB][sync] +column ${tableName}.${colName}`);
      } catch (e: unknown) {
        // Reachable when the new column is NOT NULL and the table already has
        // rows. Loud, not fatal: the app still boots on every other table.
        clean = false;
        console.warn(`[DB][sync] add column ${tableName}.${colName} failed: ${(e as Error).message}`);
      }
    }

    for (const idx of def.indexes || []) {
      try {
        await adapter.exec(idx);
      } catch (e: unknown) {
        clean = false;
        console.warn(`[DB][sync] index failed: ${(e as Error).message}`);
      }
    }
  }
  return clean;
}

/**
 * Reads the instance keys this boot compares against. A fresh database has no
 * `_meta` yet, which is the same answer as "nothing recorded".
 */
async function readBootMeta(adapter: DbAdapter): Promise<Map<string, string>> {
  try {
    const rows = (await adapter.all(
      `SELECT key, value FROM _meta WHERE key IN ('schemaHash', 'appVersion')`,
    )) as unknown as Array<{ key: string; value: string }>;
    return new Map(rows.map((row) => [row.key, row.value]));
  } catch {
    return new Map();
  }
}

export async function runMigrationOnce(adapter: DbAdapter): Promise<void> {
  if (_migratedAdapters.has(adapter)) return;
  _migratedAdapters.add(adapter);

  // The full sync is ~90 sequential round trips and it blocks the first
  // request of every cold instance, so it only runs when the declared schema
  // differs from the one last synced. Concurrent cold starts may both sync:
  // every statement is additive and idempotent, and both write the same hash.
  // ponytail: a column dropped by hand is not re-added until schema.ts changes.
  const meta: Map<string, string> = await readBootMeta(adapter);
  const hash: string = schemaHash();
  const writes: Array<[string, string]> = [];
  if (meta.get("schemaHash") !== hash) {
    // A failed DDL leaves the hash unrecorded, so the next boot retries it.
    if (await syncSchema(adapter)) writes.push(["schemaHash", hash]);
  }

  // Say it out loud on every boot when provider credentials are stored in the
  // clear. Running unencrypted is a supported mode — refusing to boot would
  // brick installs that never opted in — but it must not be silent, or an
  // operator has no way to tell the two states apart.
  // Refuses to continue when the operator declared encryption mandatory.
  assertCredentialEncryptionPolicy();
  if (!isCredentialEncryptionEnabled()) {
    console.warn(
      "[DB] Provider credentials are stored UNENCRYPTED. Set CREDENTIAL_KEY to encrypt them at rest (existing rows are encrypted on the next boot), or CREDENTIAL_ENCRYPTION_REQUIRED=true to refuse to start without it.",
    );
  }

  // Informational only — nothing branches on it, but it makes "which build
  // last touched this database" answerable from the database itself.
  const version: string = getAppVersion();
  if (meta.get("appVersion") !== version) writes.push(["appVersion", version]);
  if (writes.length === 0) return;
  await adapter.run(
    `INSERT INTO _meta(key, value) VALUES${writes.map(() => "(?, ?)").join(", ")} ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    writes.flat(),
  );
}

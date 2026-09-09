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

async function syncSchema(adapter: DbAdapter): Promise<void> {
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
        console.warn(`[DB][sync] add column ${tableName}.${colName} failed: ${(e as Error).message}`);
      }
    }

    for (const idx of def.indexes || []) {
      try {
        await adapter.exec(idx);
      } catch (e: unknown) {
        console.warn(`[DB][sync] index failed: ${(e as Error).message}`);
      }
    }
  }
}

export async function runMigrationOnce(adapter: DbAdapter): Promise<void> {
  if (_migratedAdapters.has(adapter)) return;
  _migratedAdapters.add(adapter);

  await syncSchema(adapter);

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
  await adapter.run(
    `INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ["appVersion", version],
  );
}

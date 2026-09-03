import { getAdapter } from "../driver";
import { parseJson, stringifyJson } from "../helpers/jsonCol";
import type { PatchRow } from "@/server/plugin-core/composition";

// Storage for the plugin patch layer. The table is additive and declared in
// schema.ts, so it is created by syncSchemaFromTables rather than a migration.
// See docs/superpowers/specs/2026-09-02-db-plugin-system-design.md.

const REVISION_KEY = "pluginTreeRevision";

function rowToPatchRow(row: Record<string, unknown>): PatchRow {
  return {
    id: String(row.id),
    plugin: String(row.plugin),
    config: parseJson<Record<string, unknown>>(row.config, {}) || {},
    position: Number(row.position) || 0,
    enabled: row.enabled !== 0 && row.enabled !== false,
    source: row.source === "user" ? "user" : "override",
  };
}

export async function listPluginRows(): Promise<PatchRow[]> {
  const db = await getAdapter();
  return db
    .all("SELECT id, plugin, config, position, enabled, source FROM pluginRows ORDER BY position, id")
    .map(rowToPatchRow);
}

/**
 * Monotonic counter bumped by every write. A caller compares it against the
 * revision the tree was composed from to decide whether to recompose. It is an
 * explicit counter rather than MAX(updatedAt) because two writes in the same
 * millisecond with an unchanged row count would be indistinguishable.
 */
export async function getPluginTreeRevision(): Promise<number> {
  const db = await getAdapter();
  const row = db.get("SELECT value FROM _meta WHERE key = ?", [REVISION_KEY]);
  const value = Number(row?.value);
  return Number.isFinite(value) ? value : 0;
}

function bumpRevision(db: Awaited<ReturnType<typeof getAdapter>>): void {
  const row = db.get("SELECT value FROM _meta WHERE key = ?", [REVISION_KEY]);
  const next = (Number(row?.value) || 0) + 1;
  db.run(
    "INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [REVISION_KEY, String(next)],
  );
}

export async function upsertPluginRow(row: PatchRow): Promise<void> {
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.transaction(() => {
    db.run(
      `INSERT INTO pluginRows(id, plugin, config, position, enabled, source, createdAt, updatedAt)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         plugin = excluded.plugin,
         config = excluded.config,
         position = excluded.position,
         enabled = excluded.enabled,
         source = excluded.source,
         updatedAt = excluded.updatedAt`,
      [
        row.id,
        row.plugin,
        stringifyJson(row.config),
        row.position,
        row.enabled ? 1 : 0,
        row.source,
        now,
        now,
      ],
    );
    bumpRevision(db);
  });
}

export async function deletePluginRow(id: string): Promise<void> {
  const db = await getAdapter();
  db.transaction(() => {
    db.run("DELETE FROM pluginRows WHERE id = ?", [id]);
    bumpRevision(db);
  });
}

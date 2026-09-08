import { getAdapter } from "../driver";
import { currentTenantId } from "../tenant";
import { bumpTenantMeta, getTenantMeta } from "../helpers/tenantMeta";
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
  const rows = await db.all(
    "SELECT id, plugin, config, position, enabled, source FROM pluginRows WHERE userId = ? ORDER BY position, id",
    [currentTenantId()],
  );
  return rows.map(rowToPatchRow);
}

/**
 * Monotonic counter bumped by every write. A caller compares it against the
 * revision the tree was composed from to decide whether to recompose. It is an
 * explicit counter rather than MAX(updatedAt) because two writes in the same
 * millisecond with an unchanged row count would be indistinguishable.
 */
export async function getPluginTreeRevision(): Promise<number> {
  const db = await getAdapter();
  const value = Number(await getTenantMeta(db, REVISION_KEY));
  return Number.isFinite(value) ? value : 0;
}

export async function upsertPluginRow(row: PatchRow): Promise<void> {
  const db = await getAdapter();
  const now = new Date().toISOString();
  await db.transaction(async () => {
    await db.run(
      `INSERT INTO pluginRows(userId, id, plugin, config, position, enabled, source, createdAt, updatedAt)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(userId, id) DO UPDATE SET
         plugin = excluded.plugin,
         config = excluded.config,
         position = excluded.position,
         enabled = excluded.enabled,
         source = excluded.source,
         updatedAt = excluded.updatedAt`,
      [
        currentTenantId(),
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
    await bumpTenantMeta(db, REVISION_KEY);
  });
}

export async function deletePluginRow(id: string): Promise<void> {
  const db = await getAdapter();
  await db.transaction(async () => {
    await db.run("DELETE FROM pluginRows WHERE userId = ? AND id = ?", [currentTenantId(), id]);
    await bumpTenantMeta(db, REVISION_KEY);
  });
}

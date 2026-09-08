import { getAdapter } from "../driver";
import { currentTenantId } from "../tenant";
import { bumpTenantMeta, getTenantMeta } from "../helpers/tenantMeta";

export interface AgentSkillRow {
  id: string;
  name: string;
  description: string;
  body: string;
  enabled: boolean;
  source: "override" | "user" | "imported";
  origin?: string;
}

const REVISION_KEY = "agentSkillsRevision";

function rowToSkill(row: Record<string, unknown>): AgentSkillRow {
  const source = row.source;
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description),
    body: String(row.body),
    enabled: row.enabled !== 0 && row.enabled !== false,
    source:
      source === "override" || source === "imported" ? source : "user",
    origin: typeof row.origin === "string" ? row.origin : undefined,
  };
}

export async function listAgentSkillRows(): Promise<AgentSkillRow[]> {
  const db = await getAdapter();
  const rows = await db.all(
    "SELECT id, name, description, body, enabled, source, origin FROM agentSkills WHERE userId = ? ORDER BY id",
    [currentTenantId()],
  );
  return rows.map(rowToSkill);
}

export async function getAgentSkillRow(id: string): Promise<AgentSkillRow | null> {
  const db = await getAdapter();
  const row = await db.get(
    "SELECT id, name, description, body, enabled, source, origin FROM agentSkills WHERE userId = ? AND id = ?",
    [currentTenantId(), id],
  );
  return row ? rowToSkill(row) : null;
}

export async function getAgentSkillsRevision(): Promise<number> {
  const db = await getAdapter();
  const value = Number(await getTenantMeta(db, REVISION_KEY));
  return Number.isFinite(value) ? value : 0;
}

export async function upsertAgentSkillRow(row: AgentSkillRow): Promise<void> {
  const db = await getAdapter();
  const now = new Date().toISOString();
  await db.transaction(async () => {
    await db.run(
      `INSERT INTO agentSkills(userId, id, name, description, body, enabled, source, origin, createdAt, updatedAt)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(userId, id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         body = excluded.body,
         enabled = excluded.enabled,
         source = excluded.source,
         origin = excluded.origin,
         updatedAt = excluded.updatedAt`,
      [
        currentTenantId(),
        row.id,
        row.name,
        row.description,
        row.body,
        row.enabled ? 1 : 0,
        row.source,
        row.origin ?? null,
        now,
        now,
      ],
    );
    await bumpTenantMeta(db, REVISION_KEY);
  });
}

export async function deleteAgentSkillRow(id: string): Promise<void> {
  const db = await getAdapter();
  const userId = currentTenantId();
  await db.transaction(async () => {
    await db.run("DELETE FROM agentSkills WHERE userId = ? AND id = ?", [userId, id]);
    await bumpTenantMeta(db, REVISION_KEY);
  });
}

/**
 * Delete a skill together with its auxiliary files.
 *
 * `agentSkillFiles` rows are keyed on `skillId` with no FOREIGN KEY behind
 * them, so the two tables have to be cleared together. Doing it as two repo
 * calls means two transactions, and a failure between them leaves a skill row
 * whose files have vanished — listed in the UI, but `load_skill_file` finds
 * nothing. Reaching into `agentSkillFiles` from here follows the same
 * one-repo-owns-the-cascade shape `harnessConversationsRepo` already uses for
 * its events and search rows; it is the only way to get both deletes under one
 * transaction with this adapter API.
 */
export async function deleteAgentSkillWithFiles(id: string): Promise<void> {
  const db = await getAdapter();
  const userId = currentTenantId();
  await db.transaction(async () => {
    await db.run("DELETE FROM agentSkillFiles WHERE userId = ? AND skillId = ?", [userId, id]);
    await db.run("DELETE FROM agentSkills WHERE userId = ? AND id = ?", [userId, id]);
    await bumpTenantMeta(db, REVISION_KEY);
  });
}

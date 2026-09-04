import { getAdapter } from "../driver";

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
  return db
    .all(
      "SELECT id, name, description, body, enabled, source, origin FROM agentSkills ORDER BY id",
    )
    .map(rowToSkill);
}

export async function getAgentSkillRow(id: string): Promise<AgentSkillRow | null> {
  const db = await getAdapter();
  const row = db.get(
    "SELECT id, name, description, body, enabled, source, origin FROM agentSkills WHERE id = ?",
    [id],
  );
  return row ? rowToSkill(row) : null;
}

export async function getAgentSkillsRevision(): Promise<number> {
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

export async function upsertAgentSkillRow(row: AgentSkillRow): Promise<void> {
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.transaction(() => {
    db.run(
      `INSERT INTO agentSkills(id, name, description, body, enabled, source, origin, createdAt, updatedAt)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         body = excluded.body,
         enabled = excluded.enabled,
         source = excluded.source,
         origin = excluded.origin,
         updatedAt = excluded.updatedAt`,
      [
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
    bumpRevision(db);
  });
}

export async function deleteAgentSkillRow(id: string): Promise<void> {
  const db = await getAdapter();
  db.transaction(() => {
    db.run("DELETE FROM agentSkills WHERE id = ?", [id]);
    bumpRevision(db);
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
  db.transaction(() => {
    db.run("DELETE FROM agentSkillFiles WHERE skillId = ?", [id]);
    db.run("DELETE FROM agentSkills WHERE id = ?", [id]);
    bumpRevision(db);
  });
}

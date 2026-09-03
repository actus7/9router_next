import { getAdapter } from "../driver";

export type MemoryScope = "agent" | "user";

export interface AgentMemoryEntry {
  id: string;
  scope: MemoryScope;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export const MEMORY_CHAR_LIMITS: Record<MemoryScope, number> = {
  agent: 2200,
  user: 1375,
};

const REVISION_KEY = "agentMemoryRevision";

function rowToEntry(row: Record<string, unknown>): AgentMemoryEntry {
  return {
    id: String(row.id),
    scope: row.scope === "user" ? "user" : "agent",
    content: String(row.content),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

export async function listAgentMemoryEntries(
  scope?: MemoryScope,
): Promise<AgentMemoryEntry[]> {
  const db = await getAdapter();
  const rows = scope
    ? db.all(
        "SELECT id, scope, content, createdAt, updatedAt FROM agentMemoryEntries WHERE scope = ? ORDER BY createdAt",
        [scope],
      )
    : db.all(
        "SELECT id, scope, content, createdAt, updatedAt FROM agentMemoryEntries ORDER BY scope, createdAt",
      );
  return rows.map(rowToEntry);
}

export function totalChars(entries: readonly AgentMemoryEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.content.length, 0);
}

export async function getAgentMemoryRevision(): Promise<number> {
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

export async function insertAgentMemoryEntry(
  entry: Omit<AgentMemoryEntry, "createdAt" | "updatedAt">,
): Promise<AgentMemoryEntry> {
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.transaction(() => {
    db.run(
      `INSERT INTO agentMemoryEntries(id, scope, content, createdAt, updatedAt)
       VALUES(?, ?, ?, ?, ?)`,
      [entry.id, entry.scope, entry.content, now, now],
    );
    bumpRevision(db);
  });
  return { ...entry, createdAt: now, updatedAt: now };
}

export async function updateAgentMemoryEntry(
  id: string,
  content: string,
): Promise<void> {
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.transaction(() => {
    db.run(
      "UPDATE agentMemoryEntries SET content = ?, updatedAt = ? WHERE id = ?",
      [content, now, id],
    );
    bumpRevision(db);
  });
}

export async function deleteAgentMemoryEntry(id: string): Promise<void> {
  const db = await getAdapter();
  db.transaction(() => {
    db.run("DELETE FROM agentMemoryEntries WHERE id = ?", [id]);
    bumpRevision(db);
  });
}

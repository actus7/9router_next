import { getAdapter } from "../driver";
import { currentTenantId } from "../tenant";
import { bumpTenantMeta, getTenantMeta } from "../helpers/tenantMeta";

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
    ? await db.all(
        "SELECT id, scope, content, createdAt, updatedAt FROM agentMemoryEntries WHERE userId = ? AND scope = ? ORDER BY createdAt",
        [currentTenantId(), scope],
      )
    : await db.all(
        "SELECT id, scope, content, createdAt, updatedAt FROM agentMemoryEntries WHERE userId = ? ORDER BY scope, createdAt",
        [currentTenantId()],
      );
  return rows.map(rowToEntry);
}

export function totalChars(entries: readonly AgentMemoryEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.content.length, 0);
}

export async function getAgentMemoryRevision(): Promise<number> {
  const db = await getAdapter();
  const value = Number(await getTenantMeta(db, REVISION_KEY));
  return Number.isFinite(value) ? value : 0;
}

export async function insertAgentMemoryEntry(
  entry: Omit<AgentMemoryEntry, "createdAt" | "updatedAt">,
): Promise<AgentMemoryEntry> {
  const db = await getAdapter();
  const now = new Date().toISOString();
  await db.transaction(async () => {
    await db.run(
      `INSERT INTO agentMemoryEntries(id, userId, scope, content, createdAt, updatedAt)
       VALUES(?, ?, ?, ?, ?, ?)`,
      [entry.id, currentTenantId(), entry.scope, entry.content, now, now],
    );
    await bumpTenantMeta(db, REVISION_KEY);
  });
  return { ...entry, createdAt: now, updatedAt: now };
}

export async function updateAgentMemoryEntry(
  id: string,
  content: string,
): Promise<void> {
  const db = await getAdapter();
  const now = new Date().toISOString();
  await db.transaction(async () => {
    await db.run(
      "UPDATE agentMemoryEntries SET content = ?, updatedAt = ? WHERE userId = ? AND id = ?",
      [content, now, currentTenantId(), id],
    );
    await bumpTenantMeta(db, REVISION_KEY);
  });
}

export async function deleteAgentMemoryEntry(id: string): Promise<void> {
  const db = await getAdapter();
  await db.transaction(async () => {
    await db.run("DELETE FROM agentMemoryEntries WHERE userId = ? AND id = ?", [currentTenantId(), id]);
    await bumpTenantMeta(db, REVISION_KEY);
  });
}

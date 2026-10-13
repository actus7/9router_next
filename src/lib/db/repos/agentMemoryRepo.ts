import { getAdapter } from "../driver";
import { currentActorUserId, currentTenantId, memberRowParams } from "../tenant";
import { bumpTenantMeta, getTenantMeta } from "../helpers/tenantMeta";

export type MemoryScope = "agent" | "user";

export interface AgentMemoryEntry {
  id: string;
  scope: MemoryScope;
  content: string;
  createdAt: string;
  updatedAt: string;
}

const REVISION_KEY = "agentMemoryRevision";

/**
 * Agent memory is the organization's — what the assistant learned about the
 * work is shared by everyone. User memory is personal: one member's entries
 * about themselves are never read into another member's chat. Rows from before
 * teams have no owner and belong to the tenant's owner (see MEMBER_ROWS).
 */
const VISIBLE = "userId = ? AND (scope = 'agent' OR COALESCE(ownerUserId, userId) = ?)";

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
        `SELECT id, scope, content, createdAt, updatedAt FROM agentMemoryEntries WHERE ${VISIBLE} AND scope = ? ORDER BY createdAt`,
        [...memberRowParams(), scope],
      )
    : await db.all(
        `SELECT id, scope, content, createdAt, updatedAt FROM agentMemoryEntries WHERE ${VISIBLE} ORDER BY scope, createdAt`,
        memberRowParams(),
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
      `INSERT INTO agentMemoryEntries(id, userId, scope, content, createdAt, updatedAt, ownerUserId)
       VALUES(?, ?, ?, ?, ?, ?, ?)`,
      [entry.id, currentTenantId(), entry.scope, entry.content, now, now, currentActorUserId()],
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
      `UPDATE agentMemoryEntries SET content = ?, updatedAt = ? WHERE ${VISIBLE} AND id = ?`,
      [content, now, ...memberRowParams(), id],
    );
    await bumpTenantMeta(db, REVISION_KEY);
  });
}

export async function deleteAgentMemoryEntry(id: string): Promise<void> {
  const db = await getAdapter();
  await db.transaction(async () => {
    await db.run(`DELETE FROM agentMemoryEntries WHERE ${VISIBLE} AND id = ?`, [...memberRowParams(), id]);
    await bumpTenantMeta(db, REVISION_KEY);
  });
}

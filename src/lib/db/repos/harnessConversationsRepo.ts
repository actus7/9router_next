import { getAdapter } from "../driver";
import { currentTenantId } from "../tenant";
import { parseJson, stringifyJson } from "../helpers/jsonCol";

export interface HarnessConversation {
  id: string;
  title: string;
  projectId?: string;
  providerId?: string;
  modelId?: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface HarnessEvent {
  sessionId: string;
  seq: number;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
}

function rowToConversation(row: Record<string, unknown>): HarnessConversation {
  return {
    ...(parseJson<Record<string, unknown>>(row.data, {}) || {}),
    id: String(row.id),
    title: String(row.title),
    ...(row.projectId ? { projectId: String(row.projectId) } : {}),
    ...(row.providerId ? { providerId: String(row.providerId) } : {}),
    ...(row.modelId ? { modelId: String(row.modelId) } : {}),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

export async function listHarnessConversations(): Promise<HarnessConversation[]> {
  const db = await getAdapter();
  return (await db.all("SELECT * FROM harnessConversations WHERE userId = ? ORDER BY updatedAt DESC", [currentTenantId()])).map(rowToConversation);
}

export async function replaceHarnessConversations(conversations: HarnessConversation[]): Promise<void> {
  const db = await getAdapter();
  const userId = currentTenantId();
  await db.transaction(async () => {
    const ids = conversations.map((conversation) => conversation.id).filter(Boolean);
    if (ids.length === 0) {
      await db.run("DELETE FROM harnessMessageIndex WHERE userId = ?", [userId]);
      await db.run("DELETE FROM harnessEvents WHERE userId = ?", [userId]);
      await db.run("DELETE FROM harnessConversations WHERE userId = ?", [userId]);
      return;
    }

    const placeholders = ids.map(() => "?").join(", ");
    await db.run(`DELETE FROM harnessMessageIndex WHERE userId = ? AND sessionId NOT IN (${placeholders})`, [userId, ...ids]);
    await db.run(`DELETE FROM harnessEvents WHERE userId = ? AND sessionId NOT IN (${placeholders})`, [userId, ...ids]);
    await db.run(`DELETE FROM harnessConversations WHERE userId = ? AND id NOT IN (${placeholders})`, [userId, ...ids]);
    for (const conversation of conversations) {
      const { id, title, projectId, providerId, modelId, createdAt, updatedAt, ...data } = conversation;
      await db.run(
        `INSERT INTO harnessConversations(id, userId, title, projectId, providerId, modelId, data, createdAt, updatedAt)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, projectId=excluded.projectId,
           providerId=excluded.providerId, modelId=excluded.modelId, data=excluded.data, updatedAt=excluded.updatedAt`,
        [id, userId, title, projectId || null, providerId || null, modelId || null, stringifyJson(data), createdAt, updatedAt],
      );
    }
  });
}

export async function listHarnessEvents(sessionId: string, after = 0): Promise<HarnessEvent[]> {
  const db = await getAdapter();
  const rows = await db.all(
    "SELECT sessionId, seq, type, data, createdAt FROM harnessEvents WHERE userId = ? AND sessionId = ? AND seq > ? ORDER BY seq ASC LIMIT 1000",
    [currentTenantId(), sessionId, after],
  );
  return rows.map((row) => ({
    sessionId: String(row.sessionId),
    seq: Number(row.seq),
    type: String(row.type),
    data: parseJson<Record<string, unknown>>(row.data, {}) || {},
    createdAt: String(row.createdAt),
  }));
}

export async function appendHarnessEvent(input: Omit<HarnessEvent, "seq" | "createdAt"> & { createdAt?: string }): Promise<HarnessEvent> {
  const db = await getAdapter();
  const createdAt = input.createdAt || new Date().toISOString();
  const userId = currentTenantId();
  let event: HarnessEvent | undefined;
  await db.transaction(async () => {
    const row = await db.get("SELECT COALESCE(MAX(seq), 0) + 1 AS nextSeq FROM harnessEvents WHERE userId = ? AND sessionId = ?", [userId, input.sessionId]);
    const seq = Number(row?.nextSeq || 1);
    await db.run("INSERT INTO harnessEvents(userId, sessionId, seq, type, data, createdAt) VALUES(?, ?, ?, ?, ?, ?)", [userId, input.sessionId, seq, input.type, stringifyJson(input.data), createdAt]);
    event = { sessionId: input.sessionId, seq, type: input.type, data: input.data, createdAt };
  });
  return event!;
}

import { getAdapter } from "../driver";
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
  return db.all("SELECT * FROM harnessConversations ORDER BY updatedAt DESC").map(rowToConversation);
}

export async function replaceHarnessConversations(conversations: HarnessConversation[]): Promise<void> {
  const db = await getAdapter();
  db.transaction(() => {
    const ids = conversations.map((conversation) => conversation.id).filter(Boolean);
    if (ids.length === 0) {
      db.run("DELETE FROM harnessEvents");
      db.run("DELETE FROM harnessConversations");
      return;
    }

    const placeholders = ids.map(() => "?").join(", ");
    db.run(`DELETE FROM harnessEvents WHERE sessionId NOT IN (${placeholders})`, ids);
    db.run(`DELETE FROM harnessConversations WHERE id NOT IN (${placeholders})`, ids);
    for (const conversation of conversations) {
      const { id, title, projectId, providerId, modelId, createdAt, updatedAt, ...data } = conversation;
      db.run(
        `INSERT INTO harnessConversations(id, title, projectId, providerId, modelId, data, createdAt, updatedAt)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, projectId=excluded.projectId,
           providerId=excluded.providerId, modelId=excluded.modelId, data=excluded.data, updatedAt=excluded.updatedAt`,
        [id, title, projectId || null, providerId || null, modelId || null, stringifyJson(data), createdAt, updatedAt],
      );
    }
  });
}

export async function listHarnessEvents(sessionId: string, after = 0): Promise<HarnessEvent[]> {
  const db = await getAdapter();
  return db.all(
    "SELECT sessionId, seq, type, data, createdAt FROM harnessEvents WHERE sessionId = ? AND seq > ? ORDER BY seq ASC LIMIT 1000",
    [sessionId, after],
  ).map((row) => ({
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
  let event: HarnessEvent | undefined;
  db.transaction(() => {
    const row = db.get("SELECT COALESCE(MAX(seq), 0) + 1 AS nextSeq FROM harnessEvents WHERE sessionId = ?", [input.sessionId]);
    const seq = Number(row?.nextSeq || 1);
    db.run("INSERT INTO harnessEvents(sessionId, seq, type, data, createdAt) VALUES(?, ?, ?, ?, ?)", [input.sessionId, seq, input.type, stringifyJson(input.data), createdAt]);
    event = { sessionId: input.sessionId, seq, type: input.type, data: input.data, createdAt };
  });
  return event!;
}

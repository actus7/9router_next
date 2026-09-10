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
      // Never a run still executing: the worker is mid-write, and deleting the
      // row under it loses the answer with no error anywhere. Those settle on
      // their own and are swept by the pass below on a later sync.
      await db.run("DELETE FROM harnessRuns WHERE userId = ? AND status != ?", [userId, "running"]);
      await db.run("DELETE FROM harnessConversations WHERE userId = ?", [userId]);
      return;
    }

    const placeholders = ids.map(() => "?").join(", ");
    await db.run(`DELETE FROM harnessMessageIndex WHERE userId = ? AND sessionId NOT IN (${placeholders})`, [userId, ...ids]);
    await db.run(`DELETE FROM harnessEvents WHERE userId = ? AND sessionId NOT IN (${placeholders})`, [userId, ...ids]);
    await db.run(
      `DELETE FROM harnessRuns WHERE userId = ? AND status != ? AND sessionId NOT IN (${placeholders})`,
      [userId, "running", ...ids],
    );
    await db.run(`DELETE FROM harnessConversations WHERE userId = ? AND id NOT IN (${placeholders})`, [userId, ...ids]);
    for (const conversation of conversations) {
      const { id, title, projectId, providerId, modelId, createdAt, updatedAt, ...data } = conversation;
      await db.run(
        `INSERT INTO harnessConversations(id, userId, title, projectId, providerId, modelId, data, createdAt, updatedAt)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, projectId=excluded.projectId,
           providerId=excluded.providerId, modelId=excluded.modelId, data=excluded.data, updatedAt=excluded.updatedAt
         WHERE harnessConversations.userId = excluded.userId`,
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

/**
 * Two appends to the same session race on `MAX(seq) + 1`. At READ COMMITTED
 * both transactions read the same max, both INSERT it, and whichever commits
 * second dies on `harnessEvents_pkey` — a 500 on an event the chat UI fires
 * and forgets. The winner is committed by then, so re-reading the max settles
 * it; only a conflict is retried, every other error still surfaces.
 *
 * A retry rather than a Postgres sequence: `seq` is numbered per
 * (userId, sessionId), which one shared sequence cannot produce, and the
 * contention here is a handful of concurrent events, not a hot path.
 */
const MAX_SEQ_CONFLICT_RETRIES = 5;

function isSeqConflict(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}

export async function appendHarnessEvent(input: Omit<HarnessEvent, "seq" | "createdAt"> & { createdAt?: string }): Promise<HarnessEvent> {
  const db = await getAdapter();
  const createdAt = input.createdAt || new Date().toISOString();
  const userId = currentTenantId();
  for (let attempt = 1; ; attempt++) {
    try {
      let event: HarnessEvent | undefined;
      await db.transaction(async () => {
        const row = await db.get("SELECT COALESCE(MAX(seq), 0) + 1 AS nextSeq FROM harnessEvents WHERE userId = ? AND sessionId = ?", [userId, input.sessionId]);
        const seq = Number(row?.nextSeq || 1);
        await db.run("INSERT INTO harnessEvents(userId, sessionId, seq, type, data, createdAt) VALUES(?, ?, ?, ?, ?, ?)", [userId, input.sessionId, seq, input.type, stringifyJson(input.data), createdAt]);
        event = { sessionId: input.sessionId, seq, type: input.type, data: input.data, createdAt };
      });
      return event!;
    } catch (error: unknown) {
      if (attempt >= MAX_SEQ_CONFLICT_RETRIES || !isSeqConflict(error)) throw error;
    }
  }
}

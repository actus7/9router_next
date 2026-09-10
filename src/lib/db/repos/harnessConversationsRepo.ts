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

export interface HarnessConversationSync {
  /** Conversations to create or overwrite. Anything absent is left alone. */
  upserts: readonly HarnessConversation[];
  /** Conversations to remove, named explicitly. */
  deletedIds: readonly string[];
}

/**
 * Applies a sync payload to this account's conversations.
 *
 * Replaces the old `replaceHarnessConversations`, which deleted every row the
 * payload did not mention. That made a stale or partial payload destructive: a client
 * whose initial GET had failed, or a second tab that loaded before a
 * conversation existed, wiped the rest of the account's history. Absence now
 * means "no opinion", and a deletion has to be asked for.
 *
 * An upsert that writes no row is never a silent success. There are two
 * reasons it can happen, and they are not the same thing:
 *
 *   - the server holds a newer copy, because the worker wrote a finished answer
 *     into it while this client was idle. Refused, and reported in `stale` so
 *     the caller re-reads instead of erasing the answer.
 *   - the id belongs to another account. `harnessConversations.id` is a global
 *     primary key and the statement is guarded by
 *     `WHERE userId = excluded.userId`, so it matched nothing and used to still
 *     answer ok, leaving a client that believed it had synced forever.
 */
export async function syncHarnessConversations(
  { upserts, deletedIds }: HarnessConversationSync,
): Promise<{ stale: string[] }> {
  if (upserts.length === 0 && deletedIds.length === 0) return { stale: [] };
  const db = await getAdapter();
  const userId = currentTenantId();
  const stale: string[] = [];
  await db.transaction(async () => {
    const ids = deletedIds.filter(Boolean);
    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(", ");
      await db.run(`DELETE FROM harnessMessageIndex WHERE userId = ? AND sessionId IN (${placeholders})`, [userId, ...ids]);
      await db.run(`DELETE FROM harnessEvents WHERE userId = ? AND sessionId IN (${placeholders})`, [userId, ...ids]);
      // Never a run still executing: the worker is mid-write, and deleting the
      // row under it loses the answer with no error anywhere.
      await db.run(
        `DELETE FROM harnessRuns WHERE userId = ? AND status != ? AND sessionId IN (${placeholders})`,
        [userId, "running", ...ids],
      );
      await db.run(`DELETE FROM harnessConversations WHERE userId = ? AND id IN (${placeholders})`, [userId, ...ids]);
    }
    for (const conversation of upserts) {
      const { id, title, projectId, providerId, modelId, createdAt, updatedAt, ...data } = conversation;
      const result = await db.run(
        `INSERT INTO harnessConversations(id, userId, title, projectId, providerId, modelId, data, createdAt, updatedAt)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, projectId=excluded.projectId,
           providerId=excluded.providerId, modelId=excluded.modelId, data=excluded.data, updatedAt=excluded.updatedAt
         WHERE harnessConversations.userId = excluded.userId
           AND excluded.updatedAt >= harnessConversations.updatedAt`,
        [id, userId, title, projectId || null, providerId || null, modelId || null, stringifyJson(data), createdAt, updatedAt],
      );
      if (!result || result.changes !== 0) continue;

      // Nothing was written. Ours and newer means the row is simply not ours.
      const mine = await db.get(
        "SELECT updatedAt FROM harnessConversations WHERE userId = ? AND id = ?",
        [userId, id],
      );
      if (!mine) throw new Error(`harnessConversations: conversation ${id} could not be written`);
      stale.push(id);
    }
  });
  return { stale };
}

/** What the worker knows about a finished answer. */
export interface RunAnswerPatch {
  content: string;
  status: "done" | "error";
  reasoning?: string | null;
  toolCalls?: unknown[];
  tokenUsage?: Record<string, unknown> | null;
}

/**
 * Writes a finished answer into the conversation, from the server.
 *
 * The worker used to settle the run row and stop, leaving the answer to be
 * folded in by the client — which only looks at the session that happens to be
 * open, and only if a browser comes back at all. Settled rows expire after
 * `SETTLED_RUN_TTL_MS`, so a laptop closed for a day lost a finished answer
 * the account had already paid for.
 *
 * Doing this was unsafe until sync became incremental: the client replaced the
 * whole table on every PUT, so a write from here was raced away. `updatedAt` is
 * moved forward as part of the write, which is what lets the sync refuse a
 * stale client copy instead of overwriting this.
 *
 * Returns whether anything was written. An empty answer, or a conversation the
 * client never synced, is left alone rather than turned into a blank turn.
 */
export async function appendRunAnswerToConversation(
  sessionId: string,
  messageId: string,
  patch: RunAnswerPatch,
): Promise<boolean> {
  if (!patch.content) return false;
  const db = await getAdapter();
  const userId = currentTenantId();
  return await db.transaction(async () => {
    // `FOR UPDATE` because this is a read-modify-write of the whole message
    // list. Two runs can settle in the same conversation at once, and without
    // the row lock they interleave: both read the same messages, both write,
    // and whichever committed first loses its answer with nothing to report it.
    const row = await db.get(
      "SELECT id, data, updatedAt FROM harnessConversations WHERE userId = ? AND id = ? FOR UPDATE",
      [userId, sessionId],
    );
    if (!row) return false;

    const data = parseJson<Record<string, unknown>>(row.data, {}) || {};
    const messages = Array.isArray(data.messages) ? [...(data.messages as Array<Record<string, unknown>>)] : [];
    const index = messages.findIndex((message) => message?.id === messageId);
    const answer = {
      id: messageId,
      role: "assistant",
      ...(index >= 0 ? messages[index] : {}),
      content: patch.content,
      status: patch.status,
      ...(patch.reasoning ? { reasoning: patch.reasoning } : {}),
      ...(patch.toolCalls?.length ? { toolCalls: patch.toolCalls } : {}),
      ...(patch.tokenUsage ? { tokenUsage: patch.tokenUsage } : {}),
    };
    if (index >= 0) messages[index] = answer;
    else messages.push(answer);

    const updatedAt = new Date().toISOString();
    const result = await db.run(
      "UPDATE harnessConversations SET data = ?, updatedAt = ? WHERE userId = ? AND id = ?",
      [stringifyJson({ ...data, messages }), updatedAt, userId, sessionId],
    );
    return !result || result.changes !== 0;
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

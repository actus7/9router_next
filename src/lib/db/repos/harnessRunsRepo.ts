import { getAdapter } from "../driver";
import { currentTenantId } from "../tenant";
import { parseJson, stringifyJson } from "../helpers/jsonCol";

/**
 * A chat run that survives the browser that started it.
 *
 * `partialText` is rewritten as the provider streams, so a reader that arrives
 * late still sees everything produced so far. `status` is the only thing that
 * says whether more is coming.
 */
export type HarnessRunStatus = "running" | "completed" | "failed" | "stopped";

export interface HarnessRunToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface HarnessRun {
  id: string;
  sessionId: string;
  messageId: string;
  status: HarnessRunStatus;
  model: string | null;
  partialText: string;
  reasoning: string | null;
  toolCalls: HarnessRunToolCall[];
  usage: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A run left `running` with nothing written for this long is presumed dead.
 *
 * The worker runs inside a serverless invocation that can be killed without
 * ever reaching its own error handler — a timeout, an OOM, a deploy mid-flight,
 * a dev-server recompile. Nothing else would ever settle those rows, so a
 * reader settles them instead.
 *
 * This is measured against the worker's heartbeat, not against how long the
 * run has taken: a live worker touches the row every 5s whatever the provider
 * is doing, so a minute of silence is death, not slowness. It used to be six
 * minutes precisely because there was no heartbeat to measure against, and a
 * client waiting out that window sat with its composer disabled the whole
 * time.
 */
export const STALE_RUN_MS = 60 * 1000;

/**
 * How long a settled run is kept after it stops being useful.
 *
 * A run is normally deleted the moment a client folds it into its
 * conversation, but that only happens if a client comes back. This is the
 * floor: a row nobody ever collected still goes away, so the table cannot
 * grow without bound.
 */
export const SETTLED_RUN_TTL_MS = 24 * 60 * 60 * 1000;

function rowToRun(row: Record<string, unknown>): HarnessRun {
  return {
    id: String(row.id),
    sessionId: String(row.sessionId),
    messageId: String(row.messageId),
    status: String(row.status) as HarnessRunStatus,
    model: row.model == null ? null : String(row.model),
    partialText: String(row.partialText ?? ""),
    reasoning: row.reasoning == null ? null : String(row.reasoning),
    toolCalls: parseJson<HarnessRunToolCall[]>(row.toolCalls, []) || [],
    usage: parseJson<Record<string, unknown>>(row.usage, null),
    error: row.error == null ? null : String(row.error),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

export async function createHarnessRun(run: {
  id: string;
  sessionId: string;
  messageId: string;
  model: string | null;
}): Promise<HarnessRun> {
  const db = await getAdapter();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO harnessRuns(id, userId, sessionId, messageId, status, model, partialText, reasoning, toolCalls, usage, error, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
    [run.id, currentTenantId(), run.sessionId, run.messageId, "running", run.model, "", now, now],
  );
  return {
    ...run,
    status: "running",
    partialText: "",
    reasoning: null,
    toolCalls: [],
    usage: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Overwrite the text produced so far. Cheap enough to call on a throttle.
 *
 * Returns false when the row is no longer `running`, which is how the worker
 * hears about a stop: the UPDATE simply matches nothing. That keeps the stop
 * path to one column write with no channel between the two invocations.
 */
export async function updateHarnessRunProgress(id: string, partialText: string): Promise<boolean> {
  const db = await getAdapter();
  const result = await db.run(
    "UPDATE harnessRuns SET partialText = ?, updatedAt = ? WHERE userId = ? AND id = ? AND status = ?",
    [partialText, new Date().toISOString(), currentTenantId(), id, "running"],
  );
  return result.changes > 0;
}

/**
 * Records the coarse stage a run is in, for the history list.
 *
 * Scoped to `running` like every other progress write, so a stage cannot land
 * on a row someone already stopped. Failing is fine and deliberately unreported
 * — this is a caption, and losing one must not disturb the run.
 */
export async function setHarnessRunActivity(id: string, activity: string): Promise<void> {
  const db = await getAdapter();
  await db.run(
    "UPDATE harnessRuns SET activity = ? WHERE userId = ? AND id = ? AND status = ?",
    [activity, currentTenantId(), id, "running"],
  );
}

/** Asks a running worker to stop at its next write, and settles the row now. */
export async function stopHarnessRun(id: string): Promise<void> {
  const db = await getAdapter();
  await db.run(
    "UPDATE harnessRuns SET status = ?, updatedAt = ? WHERE userId = ? AND id = ? AND status = ?",
    ["stopped", new Date().toISOString(), currentTenantId(), id, "running"],
  );
}

/**
 * Settles a running row. Returns false when it was no longer running — the
 * user pressed stop, or a reader already failed it as stale — which is how the
 * worker knows not to mirror its answer into the conversation.
 */
export async function settleHarnessRun(
  id: string,
  result: {
    status: Exclude<HarnessRunStatus, "running">;
    partialText?: string;
    reasoning?: string | null;
    toolCalls?: HarnessRunToolCall[];
    usage?: Record<string, unknown> | null;
    error?: string | null;
  },
): Promise<boolean> {
  const db = await getAdapter();
  const outcome = await db.run(
    // `AND status = 'running'` for the same reason the progress write has it: a
    // user who pressed stop already settled this row, and the worker's last
    // write lands after that. Without the guard a stop inside the final
    // progress interval was overwritten by `completed`, and the answer the user
    // interrupted was delivered in full.
    `UPDATE harnessRuns SET status = ?, partialText = COALESCE(?, partialText), reasoning = ?,
       toolCalls = ?, usage = ?, error = ?, updatedAt = ?
     WHERE userId = ? AND id = ? AND status = ?`,
    [
      result.status,
      result.partialText ?? null,
      result.reasoning ?? null,
      result.toolCalls?.length ? stringifyJson(result.toolCalls) : null,
      result.usage ? stringifyJson(result.usage) : null,
      result.error ?? null,
      new Date().toISOString(),
      currentTenantId(),
      id,
      "running",
    ],
  );
  return !outcome || outcome.changes !== 0;
}

export async function getHarnessRun(id: string): Promise<HarnessRun | null> {
  const db = await getAdapter();
  const row = await db.get("SELECT * FROM harnessRuns WHERE userId = ? AND id = ?", [currentTenantId(), id]);
  return row ? rowToRun(row) : null;
}

/** How many runs one account may have in flight before new sends are refused. */
export const MAX_CONCURRENT_RUNS = 12;

/** Runs currently executing for this account, across every conversation. */
export async function countRunningHarnessRuns(): Promise<number> {
  const db = await getAdapter();
  const row = await db.get(
    "SELECT COUNT(*) AS total FROM harnessRuns WHERE userId = ? AND status = ?",
    [currentTenantId(), "running"],
  );
  return Number(row?.total ?? 0);
}

/** Runs a returning client has not folded into its local conversation yet. */
export async function listHarnessRunsSince(sessionId: string, since: string | null): Promise<HarnessRun[]> {
  const db = await getAdapter();
  const rows = since
    ? await db.all(
        "SELECT * FROM harnessRuns WHERE userId = ? AND sessionId = ? AND updatedAt > ? ORDER BY createdAt ASC LIMIT 200",
        [currentTenantId(), sessionId, since],
      )
    : await db.all(
        "SELECT * FROM harnessRuns WHERE userId = ? AND sessionId = ? ORDER BY createdAt ASC LIMIT 200",
        [currentTenantId(), sessionId],
      );
  return rows.map(rowToRun);
}

/** What the history list needs to badge a conversation: one row per session. */
export interface HarnessRunState {
  sessionId: string;
  status: HarnessRunStatus;
  /** Coarse stage, only meaningful while `status` is `running`. */
  activity: string | null;
}

/**
 * The state of every live or unread run, across all of this account's sessions.
 *
 * Deliberately not the full rows: this is polled while the chat is open, and
 * the sidebar only needs to know whether a conversation is working, finished
 * or broke.
 */
export async function listHarnessRunStates(): Promise<HarnessRunState[]> {
  const db = await getAdapter();
  const rows = await db.all(
    "SELECT sessionId, status, activity FROM harnessRuns WHERE userId = ? ORDER BY updatedAt DESC LIMIT 200",
    [currentTenantId()],
  );
  return rows.map((row) => ({
    sessionId: String(row.sessionId),
    status: String(row.status) as HarnessRunStatus,
    activity: row.activity == null ? null : String(row.activity),
  }));
}

/**
 * Settles runs whose worker died without settling them.
 *
 * Returns how many were reaped, which is the only signal anyone gets that a
 * function was killed mid-run — the worker that would have logged it is gone.
 */
export async function failStaleHarnessRuns(now: number = Date.now()): Promise<number> {
  const db = await getAdapter();
  const cutoff = new Date(now - STALE_RUN_MS).toISOString();
  const result = await db.run(
    `UPDATE harnessRuns SET status = ?, error = ?, updatedAt = ?
     WHERE userId = ? AND status = ? AND updatedAt < ?`,
    [
      "failed",
      "The run stopped without finishing (the server was interrupted). Retry to continue.",
      new Date(now).toISOString(),
      currentTenantId(),
      "running",
      cutoff,
    ],
  );
  await db.run(
    "DELETE FROM harnessRuns WHERE userId = ? AND status != ? AND updatedAt < ?",
    [currentTenantId(), "running", new Date(now - SETTLED_RUN_TTL_MS).toISOString()],
  );
  return result.changes;
}

/** Drops runs already folded into the conversation, so the table stays small. */
export async function deleteHarnessRuns(ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  const db = await getAdapter();
  const placeholders = ids.map(() => "?").join(", ");
  await db.run(`DELETE FROM harnessRuns WHERE userId = ? AND id IN (${placeholders})`, [currentTenantId(), ...ids]);
}

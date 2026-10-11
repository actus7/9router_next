import { getAdapter } from "../driver";
import { currentTenantId } from "../tenant";
import { toPersistenceError } from "../errors";
import { STATS_WINDOW_MS, TTFT_BUCKETS, ttftBucketIndex, type ModelPerfRow } from "@/shared/observability/modelStats";

/** `throughput` is not an attempt: it adds a finished stream's generation speed and nothing else. */
export type ModelAttemptOutcome = "ok" | "fail" | "timeout" | "throughput";

export interface ModelAttemptRecord {
  modelKey: string;
  outcome: ModelAttemptOutcome;
  /** Time to first response, for a successful attempt. */
  ttftMs?: number;
  genTokens?: number;
  genMs?: number;
}

const BUCKET_COLUMNS: string[] = Array.from({ length: TTFT_BUCKETS }, (_, i) => `b${i}`);

function hourKeyOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 13);
}

/** One attempt, added to its model's bucket for the current UTC hour. */
export async function recordModelAttempt(record: ModelAttemptRecord, now: number = Date.now()): Promise<void> {
  try {
    const db = await getAdapter();
    const throughput = record.outcome === "throughput";
    const ok = record.outcome === "ok" ? 1 : 0;
    const timeout = record.outcome === "timeout" ? 1 : 0;
    const fail = ok || throughput ? 0 : 1;
    const genTokens = throughput ? Math.max(0, Math.round(record.genTokens ?? 0)) : 0;
    const genMs = throughput ? Math.max(0, Math.round(record.genMs ?? 0)) : 0;
    const buckets: number[] = new Array(TTFT_BUCKETS).fill(0);
    if (ok && record.ttftMs !== undefined && record.ttftMs >= 0) buckets[ttftBucketIndex(record.ttftMs)] = 1;

    await db.run(
      `INSERT INTO modelPerf(userId, modelKey, hourKey, ok, fail, timeout, b0, b1, b2, b3, b4, b5, b6, b7, b8, b9, genTokens, genMs)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (userId, modelKey, hourKey) DO UPDATE SET
         ok = modelPerf.ok + excluded.ok, fail = modelPerf.fail + excluded.fail, timeout = modelPerf.timeout + excluded.timeout,
         b0 = modelPerf.b0 + excluded.b0, b1 = modelPerf.b1 + excluded.b1, b2 = modelPerf.b2 + excluded.b2,
         b3 = modelPerf.b3 + excluded.b3, b4 = modelPerf.b4 + excluded.b4, b5 = modelPerf.b5 + excluded.b5,
         b6 = modelPerf.b6 + excluded.b6, b7 = modelPerf.b7 + excluded.b7, b8 = modelPerf.b8 + excluded.b8,
         b9 = modelPerf.b9 + excluded.b9,
         genTokens = modelPerf.genTokens + excluded.genTokens, genMs = modelPerf.genMs + excluded.genMs`,
      [currentTenantId(), record.modelKey, hourKeyOf(now), ok, fail, timeout, ...buckets, genTokens, genMs],
    );
  } catch (error) {
    throw toPersistenceError("modelPerf.record", error);
  }
}

/** The tenant's per-hour rows inside the stats window. */
export async function readModelPerf(now: number = Date.now()): Promise<ModelPerfRow[]> {
  try {
    const db = await getAdapter();
    const rows = await db.all(
      `SELECT modelKey, hourKey, ok, fail, timeout, ${BUCKET_COLUMNS.join(", ")}, genTokens, genMs FROM modelPerf WHERE userId = ? AND hourKey >= ?`,
      [currentTenantId(), hourKeyOf(now - STATS_WINDOW_MS)],
    ) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      modelKey: String(r.modelKey),
      hourKey: String(r.hourKey),
      ok: Number(r.ok) || 0,
      fail: Number(r.fail) || 0,
      timeout: Number(r.timeout) || 0,
      b: BUCKET_COLUMNS.map((c) => Number(r[c]) || 0),
      genTokens: Number(r.genTokens) || 0,
      genMs: Number(r.genMs) || 0,
    }));
  } catch (error) {
    throw toPersistenceError("modelPerf.read", error);
  }
}

/** Rows older than the stats window are never read again: drop them. */
export async function pruneModelPerf(now: number = Date.now()): Promise<void> {
  try {
    const db = await getAdapter();
    await db.run(`DELETE FROM modelPerf WHERE userId = ? AND hourKey < ?`, [currentTenantId(), hourKeyOf(now - STATS_WINDOW_MS)]);
  } catch (error) {
    throw toPersistenceError("modelPerf.prune", error);
  }
}

/** Drops the tenant's measurements (the "reset health" action). */
export async function clearModelPerf(): Promise<void> {
  try {
    const db = await getAdapter();
    await db.run(`DELETE FROM modelPerf WHERE userId = ?`, [currentTenantId()]);
  } catch (error) {
    throw toPersistenceError("modelPerf.clear", error);
  }
}

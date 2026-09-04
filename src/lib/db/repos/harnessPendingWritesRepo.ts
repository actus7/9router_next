import { getAdapter } from "../driver";
import { parseJson, stringifyJson } from "../helpers/jsonCol";
import type {
  HarnessPendingWrite,
  NewHarnessPendingWrite,
  PendingWriteKind,
  PendingWriteStatus,
} from "@/shared/harness/pendingWrites";

export type {
  HarnessPendingWrite,
  PendingWriteKind,
  PendingWriteStatus,
} from "@/shared/harness/pendingWrites";

function rowToPending(row: Record<string, unknown>): HarnessPendingWrite {
  return {
    id: String(row.id),
    kind: row.kind as PendingWriteKind,
    action: String(row.action),
    payload: parseJson<Record<string, unknown>>(row.payload, {}) || {},
    source: row.source === "review" ? "review" : "agent",
    status: (row.status || "pending") as PendingWriteStatus,
    ...(row.reviewedAt ? { reviewedAt: String(row.reviewedAt) } : {}),
    ...(row.result
      ? { result: parseJson<Record<string, unknown>>(row.result, {}) || {} }
      : {}),
    createdAt: String(row.createdAt),
  } as HarnessPendingWrite;
}

export async function listHarnessPendingWrites(
  kind?: PendingWriteKind,
  status: PendingWriteStatus = "pending",
): Promise<HarnessPendingWrite[]> {
  const db = await getAdapter();
  const rows = kind
    ? db.all(
        "SELECT id, kind, action, payload, source, status, reviewedAt, result, createdAt FROM harnessPendingWrites WHERE kind = ? AND status = ? ORDER BY createdAt",
        [kind, status],
      )
    : db.all(
        "SELECT id, kind, action, payload, source, status, reviewedAt, result, createdAt FROM harnessPendingWrites WHERE status = ? ORDER BY createdAt",
        [status],
      );
  return rows.map(rowToPending);
}

export async function insertHarnessPendingWrite(
  write: NewHarnessPendingWrite,
): Promise<HarnessPendingWrite> {
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO harnessPendingWrites(id, kind, action, payload, source, status, createdAt)
     VALUES(?, ?, ?, ?, ?, 'pending', ?)`,
    [
      write.id,
      write.kind,
      write.action,
      stringifyJson(write.payload),
      write.source,
      now,
    ],
  );
  return { ...write, status: "pending", createdAt: now };
}

export async function resolveHarnessPendingWrite(
  id: string,
  status: Exclude<PendingWriteStatus, "pending">,
  result: Record<string, unknown>,
): Promise<void> {
  const db = await getAdapter();
  db.run(
    "UPDATE harnessPendingWrites SET status = ?, reviewedAt = ?, result = ? WHERE id = ? AND status = 'pending'",
    [status, new Date().toISOString(), stringifyJson(result), id],
  );
}

export async function getHarnessPendingWrite(
  id: string,
): Promise<HarnessPendingWrite | null> {
  const db = await getAdapter();
  const row = db.get(
    "SELECT id, kind, action, payload, source, status, reviewedAt, result, createdAt FROM harnessPendingWrites WHERE id = ?",
    [id],
  );
  return row ? rowToPending(row) : null;
}

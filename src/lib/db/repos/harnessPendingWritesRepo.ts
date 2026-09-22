import { getAdapter } from "../driver";
import { currentTenantId } from "../tenant";
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
    ...(row.risk ? { risk: parseJson(row.risk, undefined) } : {}),
    createdAt: String(row.createdAt),
  } as HarnessPendingWrite;
}

export async function listHarnessPendingWrites(
  kind?: PendingWriteKind,
  status: PendingWriteStatus = "pending",
): Promise<HarnessPendingWrite[]> {
  const db = await getAdapter();
  const rows = kind
    ? await db.all(
        "SELECT id, kind, action, payload, source, status, reviewedAt, result, risk, createdAt FROM harnessPendingWrites WHERE userId = ? AND kind = ? AND status = ? ORDER BY createdAt",
        [currentTenantId(), kind, status],
      )
    : await db.all(
        "SELECT id, kind, action, payload, source, status, reviewedAt, result, risk, createdAt FROM harnessPendingWrites WHERE userId = ? AND status = ? ORDER BY createdAt",
        [currentTenantId(), status],
      );
  return rows.map(rowToPending);
}

export async function insertHarnessPendingWrite(
  write: NewHarnessPendingWrite,
): Promise<HarnessPendingWrite> {
  const db = await getAdapter();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO harnessPendingWrites(id, userId, kind, action, payload, source, status, risk, createdAt)
     VALUES(?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      write.id,
      currentTenantId(),
      write.kind,
      write.action,
      stringifyJson(write.payload),
      write.source,
      write.risk ? stringifyJson(write.risk) : null,
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
  await db.run(
    "UPDATE harnessPendingWrites SET status = ?, reviewedAt = ?, result = ? WHERE userId = ? AND id = ? AND status = 'pending'",
    [status, new Date().toISOString(), stringifyJson(result), currentTenantId(), id],
  );
}

export async function getHarnessPendingWrite(
  id: string,
): Promise<HarnessPendingWrite | null> {
  const db = await getAdapter();
  const row = await db.get(
    "SELECT id, kind, action, payload, source, status, reviewedAt, result, risk, createdAt FROM harnessPendingWrites WHERE userId = ? AND id = ?",
    [currentTenantId(), id],
  );
  return row ? rowToPending(row) : null;
}

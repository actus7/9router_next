import { getAdapter } from "../driver";
import { parseJson, stringifyJson } from "../helpers/jsonCol";

export type PendingWriteKind = "memory" | "skill" | "plugin";
export type PendingWriteSource = "agent" | "review";

export interface HarnessPendingWrite {
  id: string;
  kind: PendingWriteKind;
  action: string;
  payload: Record<string, unknown>;
  source: PendingWriteSource;
  createdAt: string;
}

function rowToPending(row: Record<string, unknown>): HarnessPendingWrite {
  return {
    id: String(row.id),
    kind: row.kind as PendingWriteKind,
    action: String(row.action),
    payload: parseJson<Record<string, unknown>>(row.payload, {}) || {},
    source: row.source === "review" ? "review" : "agent",
    createdAt: String(row.createdAt),
  };
}

export async function listHarnessPendingWrites(
  kind?: PendingWriteKind,
): Promise<HarnessPendingWrite[]> {
  const db = await getAdapter();
  const rows = kind
    ? db.all(
        "SELECT id, kind, action, payload, source, createdAt FROM harnessPendingWrites WHERE kind = ? ORDER BY createdAt",
        [kind],
      )
    : db.all(
        "SELECT id, kind, action, payload, source, createdAt FROM harnessPendingWrites ORDER BY createdAt",
      );
  return rows.map(rowToPending);
}

export async function insertHarnessPendingWrite(
  write: Omit<HarnessPendingWrite, "createdAt">,
): Promise<HarnessPendingWrite> {
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO harnessPendingWrites(id, kind, action, payload, source, createdAt)
     VALUES(?, ?, ?, ?, ?, ?)`,
    [
      write.id,
      write.kind,
      write.action,
      stringifyJson(write.payload),
      write.source,
      now,
    ],
  );
  return { ...write, createdAt: now };
}

export async function deleteHarnessPendingWrite(id: string): Promise<void> {
  const db = await getAdapter();
  db.run("DELETE FROM harnessPendingWrites WHERE id = ?", [id]);
}

export async function getHarnessPendingWrite(
  id: string,
): Promise<HarnessPendingWrite | null> {
  const db = await getAdapter();
  const row = db.get(
    "SELECT id, kind, action, payload, source, createdAt FROM harnessPendingWrites WHERE id = ?",
    [id],
  );
  return row ? rowToPending(row) : null;
}

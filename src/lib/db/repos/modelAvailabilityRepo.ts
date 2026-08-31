import { getAdapter } from "../driver";

export type ModelAvailabilityStatus = "cooldown" | "unavailable";
export type ModelAvailabilityReason = "quota" | "rate_limit" | "billing" | "model" | "transient" | "legacy";

export interface ModelAvailability {
  connectionId: string;
  modelId: string;
  status: ModelAvailabilityStatus;
  reason: ModelAvailabilityReason;
  errorCode: number | null;
  lastError: string | null;
  until: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToAvailability(row: Record<string, unknown>): ModelAvailability {
  return {
    connectionId: String(row.connectionId),
    modelId: String(row.modelId),
    status: row.status === "unavailable" ? "unavailable" : "cooldown",
    reason: ["quota", "rate_limit", "billing", "model", "transient", "legacy"].includes(String(row.reason))
      ? String(row.reason) as ModelAvailabilityReason
      : "legacy",
    errorCode: typeof row.errorCode === "number" ? row.errorCode : null,
    lastError: typeof row.lastError === "string" ? row.lastError : null,
    until: typeof row.until === "string" ? row.until : null,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

export async function getActiveModelAvailability(connectionIds?: string[], modelId?: string | null): Promise<ModelAvailability[]> {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const where = ["(until IS NULL OR until > ?)"];
  const params: unknown[] = [now];
  if (connectionIds?.length) {
    where.push(`connectionId IN (${connectionIds.map(() => "?").join(", ")})`);
    params.push(...connectionIds);
  }
  if (modelId) {
    where.push("modelId IN (?, '__all')");
    params.push(modelId);
  }
  return db.all(`SELECT * FROM modelAvailability WHERE ${where.join(" AND ")} ORDER BY until ASC`, params)
    .map(rowToAvailability);
}

export async function setModelAvailability(input: Omit<ModelAvailability, "createdAt" | "updatedAt">): Promise<void> {
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO modelAvailability(connectionId, modelId, status, reason, errorCode, lastError, until, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(connectionId, modelId) DO UPDATE SET status=excluded.status, reason=excluded.reason,
       errorCode=excluded.errorCode, lastError=excluded.lastError, until=excluded.until, updatedAt=excluded.updatedAt`,
    [input.connectionId, input.modelId, input.status, input.reason, input.errorCode, input.lastError, input.until, now, now],
  );
}

export async function clearModelAvailability(connectionId: string, modelId?: string | null): Promise<number> {
  const db = await getAdapter();
  if (!modelId) return db.run("DELETE FROM modelAvailability WHERE connectionId = ?", [connectionId]).changes;
  return db.run("DELETE FROM modelAvailability WHERE connectionId = ? AND modelId IN (?, '__all')", [connectionId, modelId]).changes;
}

export async function clearProviderModelAvailability(connectionIds: string[], modelId: string): Promise<number> {
  if (connectionIds.length === 0) return 0;
  const db = await getAdapter();
  return db.run(
    `DELETE FROM modelAvailability WHERE modelId = ? AND connectionId IN (${connectionIds.map(() => "?").join(", ")})`,
    [modelId, ...connectionIds],
  ).changes;
}

export async function cleanupExpiredModelAvailability(): Promise<number> {
  const db = await getAdapter();
  return db.run("DELETE FROM modelAvailability WHERE until IS NOT NULL AND until <= ?", [new Date().toISOString()]).changes;
}

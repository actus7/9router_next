import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver";

/**
 * Where a key was propagated to. One key per destination is what makes the
 * inventory answerable and rotation per-destination: revoking a CLI tool's key
 * cannot break a cloud deployment, because they never share one.
 *
 * `manual` covers keys the operator created themselves and rows written before
 * the column existed — nothing knows where those went, which is exactly the
 * state this type exists to stop reproducing.
 */
export type ApiKeySink =
  | "manual"
  | "dashboard"
  | `cli:${string}`
  | `cloud:${string}`;

interface ApiKeyRow {
  id: string;
  key: string;
  name: string | null;
  machineId: string | null;
  isActive: number | boolean;
  createdAt: string;
  sink: string | null;
  sinkRef: string | null;
  revokedAt: string | null;
}

interface ApiKey {
  id: string;
  key: string;
  name: string | null;
  machineId: string | null;
  isActive: boolean;
  createdAt: string;
  sink: ApiKeySink;
  sinkRef: string | null;
  revokedAt: string | null;
}

function rowToKey(row: ApiKeyRow | undefined): ApiKey | null {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    sink: (row.sink as ApiKeySink) || "manual",
    sinkRef: row.sinkRef ?? null,
    revokedAt: row.revokedAt ?? null,
  };
}

export async function getApiKeys(): Promise<ApiKey[]> {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`) as unknown as ApiKeyRow[];
  return rows.map(rowToKey).filter((k): k is ApiKey => k !== null);
}

export async function getApiKeyById(id: string): Promise<ApiKey | null> {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]) as ApiKeyRow | undefined;
  return rowToKey(row);
}

export async function createApiKey(
  name: string,
  machineId: string,
  sink: ApiKeySink = "manual",
  sinkRef: string | null = null,
): Promise<ApiKey> {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result: { key: string } = generateApiKeyWithMachine(machineId);
  const apiKey: ApiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
    sink,
    sinkRef,
    revokedAt: null,
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, sink, sinkRef, revokedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt, sink, sinkRef]
  );
  return apiKey;
}

/**
 * The live key for one destination, if there is one.
 *
 * Reconfiguring a CLI tool or redeploying a cloud target must reuse the key
 * already issued for it, otherwise every click mints another row and the
 * inventory fills with keys nobody can account for.
 */
export async function getActiveApiKeyBySink(sink: ApiKeySink): Promise<ApiKey | null> {
  const db = await getAdapter();
  const row = db.get(
    `SELECT * FROM apiKeys WHERE sink = ? AND isActive = 1 ORDER BY createdAt DESC`,
    [sink],
  ) as ApiKeyRow | undefined;
  return rowToKey(row);
}

/**
 * Issue the key for a destination, reusing the live one when it exists.
 * `sinkRef` is refreshed on reuse so a tool whose config path moved stays
 * locatable in the inventory.
 */
export async function issueApiKeyForSink(
  name: string,
  machineId: string,
  sink: ApiKeySink,
  sinkRef: string | null = null,
): Promise<ApiKey> {
  const existing = await getActiveApiKeyBySink(sink);
  if (existing) {
    if (sinkRef && existing.sinkRef !== sinkRef) {
      const db = await getAdapter();
      db.run(`UPDATE apiKeys SET sinkRef = ? WHERE id = ?`, [sinkRef, existing.id]);
      return { ...existing, sinkRef };
    }
    return existing;
  }
  return createApiKey(name, machineId, sink, sinkRef);
}

/**
 * Retire a destination's key.
 *
 * `isActive = 0` is the part that stops it authenticating — `validateApiKey`
 * reads that column and nothing else, so the hot path is untouched. The row
 * itself survives so `usageHistory` can still resolve which key spent what;
 * deleting it would rewrite the past.
 */
export async function revokeApiKeysForSink(sink: ApiKeySink): Promise<number> {
  const db = await getAdapter();
  const res = db.run(
    `UPDATE apiKeys SET isActive = 0, revokedAt = ? WHERE sink = ? AND isActive = 1`,
    [new Date().toISOString(), sink],
  );
  return res?.changes ?? 0;
}

export async function updateApiKey(id: string, data: Partial<ApiKey>): Promise<ApiKey | null> {
  const db = await getAdapter();
  let result: ApiKey | null = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]) as ApiKeyRow | undefined;
    if (!row) return;
    const merged: ApiKey = { ...rowToKey(row)!, ...data };
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, sink = ?, sinkRef = ?, revokedAt = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, merged.sink, merged.sinkRef, merged.revokedAt, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteApiKey(id: string): Promise<boolean> {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key: string): Promise<boolean> {
  const db = await getAdapter();
  const row = db.get(`SELECT isActive FROM apiKeys WHERE key = ?`, [key]) as { isActive: number | boolean } | undefined;
  if (!row) return false;
  return row.isActive === 1 || row.isActive === true;
}

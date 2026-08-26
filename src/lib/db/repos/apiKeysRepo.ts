import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver";

interface ApiKeyRow {
  id: string;
  key: string;
  name: string | null;
  machineId: string | null;
  isActive: number | boolean;
  createdAt: string;
}

interface ApiKey {
  id: string;
  key: string;
  name: string | null;
  machineId: string | null;
  isActive: boolean;
  createdAt: string;
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

export async function createApiKey(name: string, machineId: string): Promise<ApiKey> {
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
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt]
  );
  return apiKey;
}

export async function updateApiKey(id: string, data: Partial<ApiKey>): Promise<ApiKey | null> {
  const db = await getAdapter();
  let result: ApiKey | null = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]) as ApiKeyRow | undefined;
    if (!row) return;
    const merged: ApiKey = { ...rowToKey(row)!, ...data };
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, id]
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

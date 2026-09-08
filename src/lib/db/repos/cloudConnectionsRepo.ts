import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver";
import { currentTenantId } from "../tenant";
import { parseJson, stringifyJson } from "../helpers/jsonCol";

interface ConnectionRow {
  id: string;
  provider: string;
  label: string | null;
  data: string;
  createdAt: string;
  updatedAt: string;
}

export interface CloudConnection {
  id: string;
  provider: string;
  label: string | null;
  createdAt: string;
  updatedAt: string;
  token: string;
  externalUserEmail: string | null;
  externalOrgId: string | null;
  externalOrgName: string | null;
}

function rowToConnection(row: ConnectionRow | undefined): CloudConnection | null {
  if (!row) return null;
  const extra = parseJson(row.data, {}) as Record<string, unknown>;
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    token: (extra.token as string) ?? "",
    externalUserEmail: (extra.externalUserEmail as string) ?? null,
    externalOrgId: (extra.externalOrgId as string) ?? null,
    externalOrgName: (extra.externalOrgName as string) ?? null,
  };
}

function connectionToRow(c: CloudConnection): Record<string, unknown> {
  const { id, provider, label, createdAt, updatedAt, ...rest } = c;
  return {
    id,
    provider,
    label: label ?? null,
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

interface DbLike {
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  get(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined>;
  all(sql: string, params?: unknown[]): Promise<Array<Record<string, unknown>>>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

async function upsert(db: DbLike, c: CloudConnection): Promise<void> {
  const r = connectionToRow(c);
  await db.run(
    `INSERT INTO cloudConnections(id, userId, provider, label, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       provider=excluded.provider, label=excluded.label,
       data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, currentTenantId(), r.provider, r.label, r.data, r.createdAt, r.updatedAt]
  );
}

export async function getCloudConnections(): Promise<CloudConnection[]> {
  const db = await getAdapter();
  const list = (await db.all(`SELECT * FROM cloudConnections WHERE userId = ?`, [currentTenantId()]) as unknown as ConnectionRow[])
    .map(rowToConnection)
    .filter((c): c is CloudConnection => c !== null);
  list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return list;
}

export async function getCloudConnectionByProvider(provider: string): Promise<CloudConnection | null> {
  const db = await getAdapter();
  return rowToConnection(await db.get(`SELECT * FROM cloudConnections WHERE userId = ? AND provider = ?`, [currentTenantId(), provider]) as ConnectionRow | undefined);
}

export async function getCloudConnectionById(id: string): Promise<CloudConnection | null> {
  const db = await getAdapter();
  return rowToConnection(await db.get(`SELECT * FROM cloudConnections WHERE userId = ? AND id = ?`, [currentTenantId(), id]) as ConnectionRow | undefined);
}

interface ConnectionInput {
  provider: string;
  label?: string | null;
  token: string;
  externalUserEmail?: string | null;
  externalOrgId?: string | null;
  externalOrgName?: string | null;
}

export async function createCloudConnection(data: ConnectionInput): Promise<CloudConnection> {
  const db = await getAdapter();
  const now = new Date().toISOString();
  let result!: CloudConnection;
  await db.transaction(async () => {
    const existing = await db.get(`SELECT * FROM cloudConnections WHERE userId = ? AND provider = ?`, [currentTenantId(), data.provider]) as ConnectionRow | undefined;
    const connection: CloudConnection = {
      id: existing?.id ?? uuidv4(),
      provider: data.provider,
      label: data.label ?? null,
      token: data.token,
      externalUserEmail: data.externalUserEmail ?? null,
      externalOrgId: data.externalOrgId ?? null,
      externalOrgName: data.externalOrgName ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await upsert(db, connection);
    result = connection;
  });
  return result;
}

export async function deleteCloudConnection(id: string): Promise<CloudConnection | null> {
  const db = await getAdapter();
  let removed: CloudConnection | null = null;
  await db.transaction(async () => {
    const row = await db.get(`SELECT * FROM cloudConnections WHERE userId = ? AND id = ?`, [currentTenantId(), id]) as ConnectionRow | undefined;
    if (!row) return;
    removed = rowToConnection(row);
    await db.run(`DELETE FROM cloudConnections WHERE userId = ? AND id = ?`, [currentTenantId(), id]);
  });
  return removed;
}

import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver";
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
  run(sql: string, params?: unknown[]): void;
  get(sql: string, params?: unknown[]): Record<string, unknown> | undefined;
  all(sql: string, params?: unknown[]): Array<Record<string, unknown>>;
  transaction(fn: () => void): void;
}

function upsert(db: DbLike, c: CloudConnection): void {
  const r = connectionToRow(c);
  db.run(
    `INSERT INTO cloudConnections(id, provider, label, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       provider=excluded.provider, label=excluded.label,
       data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.provider, r.label, r.data, r.createdAt, r.updatedAt]
  );
}

export async function getCloudConnections(): Promise<CloudConnection[]> {
  const db = await getAdapter();
  const list = (db.all(`SELECT * FROM cloudConnections`) as unknown as ConnectionRow[])
    .map(rowToConnection)
    .filter((c): c is CloudConnection => c !== null);
  list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return list;
}

export async function getCloudConnectionByProvider(provider: string): Promise<CloudConnection | null> {
  const db = await getAdapter();
  return rowToConnection(db.get(`SELECT * FROM cloudConnections WHERE provider = ?`, [provider]) as ConnectionRow | undefined);
}

export async function getCloudConnectionById(id: string): Promise<CloudConnection | null> {
  const db = await getAdapter();
  return rowToConnection(db.get(`SELECT * FROM cloudConnections WHERE id = ?`, [id]) as ConnectionRow | undefined);
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
  db.transaction(() => {
    const existing = db.get(`SELECT * FROM cloudConnections WHERE provider = ?`, [data.provider]) as ConnectionRow | undefined;
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
    upsert(db, connection);
    result = connection;
  });
  return result;
}

export async function deleteCloudConnection(id: string): Promise<CloudConnection | null> {
  const db = await getAdapter();
  let removed: CloudConnection | null = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM cloudConnections WHERE id = ?`, [id]) as ConnectionRow | undefined;
    if (!row) return;
    removed = rowToConnection(row);
    db.run(`DELETE FROM cloudConnections WHERE id = ?`, [id]);
  });
  return removed;
}

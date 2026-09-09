import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver";
import { currentTenantId } from "../tenant";
import { parseJson, stringifyJson } from "../helpers/jsonCol";

interface NodeRow {
  id: string;
  type: string | null;
  name: string | null;
  data: string;
  createdAt: string;
  updatedAt: string;
}

interface ProviderNode {
  id: string;
  type: string | null;
  name: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

function rowToNode(row: NodeRow | undefined): ProviderNode | null {
  if (!row) return null;
  const extra: Record<string, unknown> = parseJson(row.data, {}) as Record<string, unknown>;
  return {
    ...extra,
    id: row.id,
    type: row.type,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } as ProviderNode;
}

function nodeToRow(n: ProviderNode): Record<string, unknown> {
  const { id, type, name, createdAt, updatedAt, ...rest } = n;
  return {
    id,
    type: type ?? null,
    name: name ?? null,
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

interface DbLike {
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  get(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined>;
  all(sql: string, params?: unknown[]): Promise<Array<Record<string, unknown>>>;
}

async function upsert(db: DbLike, n: ProviderNode): Promise<void> {
  const r = nodeToRow(n);
  await db.run(
    `INSERT INTO providerNodes(id, userId, type, name, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       type=excluded.type, name=excluded.name, data=excluded.data, updatedAt=excluded.updatedAt
     WHERE providerNodes.userId = excluded.userId`,
    [r.id, currentTenantId(), r.type, r.name, r.data, r.createdAt, r.updatedAt]
  );
}

interface NodeFilter {
  type?: string;
}

export async function getProviderNodes(filter: NodeFilter = {}): Promise<ProviderNode[]> {
  const db = await getAdapter();
  const where: string[] = [];
  const params: unknown[] = [currentTenantId()];
  if (filter.type) { where.push("type = ?"); params.push(filter.type); }
  const sql: string = `SELECT * FROM providerNodes WHERE userId = ?${where.length ? ` AND ${where.join(" AND ")}` : ""}`;
  return (await db.all(sql, params) as unknown as NodeRow[]).map(rowToNode).filter((n): n is ProviderNode => n !== null);
}

export async function getProviderNodeById(id: string): Promise<ProviderNode | null> {
  const db = await getAdapter();
  return rowToNode(await db.get(`SELECT * FROM providerNodes WHERE userId = ? AND id = ?`, [currentTenantId(), id]) as NodeRow | undefined);
}

interface NodeInput {
  id?: string;
  type: string;
  name: string;
  prefix?: string;
  apiType?: string;
  baseUrl?: string;
  [key: string]: unknown;
}

export async function createProviderNode(data: NodeInput): Promise<ProviderNode> {
  const db = await getAdapter();
  const now: string = new Date().toISOString();
  const node: ProviderNode = {
    id: data.id || uuidv4(),
    type: data.type,
    name: data.name,
    createdAt: now,
    updatedAt: now,
  };
  await upsert(db, node);
  return node;
}

export async function updateProviderNode(id: string, data: Partial<ProviderNode>): Promise<ProviderNode | null> {
  const db = await getAdapter();
  let result: ProviderNode | null = null;
  await db.transaction(async () => {
    const row: NodeRow | undefined = await db.get(`SELECT * FROM providerNodes WHERE userId = ? AND id = ?`, [currentTenantId(), id]) as NodeRow | undefined;
    if (!row) return;
    const merged: ProviderNode = { ...rowToNode(row)!, ...data, updatedAt: new Date().toISOString() };
    await upsert(db, merged);
    result = merged;
  });
  return result;
}

export async function deleteProviderNode(id: string): Promise<ProviderNode | null> {
  const db = await getAdapter();
  let removed: ProviderNode | null = null;
  await db.transaction(async () => {
    const row: NodeRow | undefined = await db.get(`SELECT * FROM providerNodes WHERE userId = ? AND id = ?`, [currentTenantId(), id]) as NodeRow | undefined;
    if (!row) return;
    removed = rowToNode(row);
    await db.run(`DELETE FROM providerNodes WHERE userId = ? AND id = ?`, [currentTenantId(), id]);
  });
  return removed;
}

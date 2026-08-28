import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver";
import { parseJson, stringifyJson } from "../helpers/jsonCol";

interface PoolRow {
  id: string;
  isActive: number | boolean;
  testStatus: string | null;
  data: string;
  createdAt: string;
  updatedAt: string;
}

interface ProxyPool {
  id: string;
  isActive: boolean;
  testStatus: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

function rowToPool(row: PoolRow | undefined): ProxyPool | null {
  if (!row) return null;
  const extra: Record<string, unknown> = parseJson(row.data, {}) as Record<string, unknown>;
  return {
    ...extra,
    id: row.id,
    isActive: row.isActive === 1 || row.isActive === true,
    testStatus: row.testStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } as ProxyPool;
}

function poolToRow(p: ProxyPool): Record<string, unknown> {
  const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
  return {
    id,
    isActive: isActive === false ? 0 : 1,
    testStatus: testStatus ?? null,
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

interface DbLike {
  run(sql: string, params?: unknown[]): void;
  get(sql: string, params?: unknown[]): Record<string, unknown> | undefined;
  all(sql: string, params?: unknown[]): Array<Record<string, unknown>>;
}

function upsert(db: DbLike, p: ProxyPool): void {
  const r = poolToRow(p);
  db.run(
    `INSERT INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       isActive=excluded.isActive, testStatus=excluded.testStatus,
       data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.isActive, r.testStatus, r.data, r.createdAt, r.updatedAt]
  );
}

interface PoolFilter {
  isActive?: boolean;
  testStatus?: string;
}

export async function getProxyPools(filter: PoolFilter = {}): Promise<ProxyPool[]> {
  const db = await getAdapter();
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.isActive !== undefined) { where.push("isActive = ?"); params.push(filter.isActive ? 1 : 0); }
  if (filter.testStatus) { where.push("testStatus = ?"); params.push(filter.testStatus); }
  const sql: string = `SELECT * FROM proxyPools${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  const list: ProxyPool[] = (db.all(sql, params) as unknown as PoolRow[]).map(rowToPool).filter((p): p is ProxyPool => p !== null);
  list.sort((a: ProxyPool, b: ProxyPool) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
  return list;
}

export async function getProxyPoolById(id: string): Promise<ProxyPool | null> {
  const db = await getAdapter();
  return rowToPool(db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]) as PoolRow | undefined);
}

interface PoolInput {
  id?: string;
  name?: string;
  proxyUrl?: string;
  noProxy?: string;
  type?: string;
  isActive?: boolean;
  strictProxy?: boolean;
  testStatus?: string;
  lastTestedAt?: string | null;
  lastError?: string | null;
  [key: string]: unknown;
}

export async function createProxyPool(data: PoolInput): Promise<ProxyPool> {
  const db = await getAdapter();
  const now: string = new Date().toISOString();
  const pool: ProxyPool = {
    id: data.id || uuidv4(),
    name: data.name,
    proxyUrl: data.proxyUrl,
    noProxy: data.noProxy || "",
    type: data.type || "http",
    isActive: data.isActive !== undefined ? data.isActive : true,
    strictProxy: data.strictProxy === true,
    testStatus: data.testStatus || "unknown",
    lastTestedAt: data.lastTestedAt || null,
    lastError: data.lastError || null,
    createdAt: now,
    updatedAt: now,
  } as ProxyPool;
  upsert(db, pool);
  return pool;
}

export async function updateProxyPool(id: string, data: Partial<ProxyPool>): Promise<ProxyPool | null> {
  const db = await getAdapter();
  let result: ProxyPool | null = null;
  db.transaction(() => {
    const row: PoolRow | undefined = db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]) as PoolRow | undefined;
    if (!row) return;
    const merged: ProxyPool = { ...rowToPool(row)!, ...data, updatedAt: new Date().toISOString() };
    upsert(db, merged);
    result = merged;
  });
  return result;
}

export async function deleteProxyPool(id: string): Promise<ProxyPool | null> {
  const db = await getAdapter();
  let removed: ProxyPool | null = null;
  db.transaction(() => {
    const row: PoolRow | undefined = db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]) as PoolRow | undefined;
    if (!row) return;
    removed = rowToPool(row);
    db.run(`DELETE FROM proxyPools WHERE id = ?`, [id]);
  });
  return removed;
}

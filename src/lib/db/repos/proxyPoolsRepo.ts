import { v4 as uuidv4 } from "uuid";
import { chunked, placeholderList } from "../helpers/batch";
import { getAdapter } from "../driver";
import { currentTenantId } from "../tenant";
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
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  get(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined>;
  all(sql: string, params?: unknown[]): Promise<Array<Record<string, unknown>>>;
}

async function upsert(db: DbLike, p: ProxyPool): Promise<void> {
  const r = poolToRow(p);
  await db.run(
    `INSERT INTO proxyPools(id, userId, isActive, testStatus, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       isActive=excluded.isActive, testStatus=excluded.testStatus,
       data=excluded.data, updatedAt=excluded.updatedAt
     WHERE proxyPools.userId = excluded.userId`,
    [r.id, currentTenantId(), r.isActive, r.testStatus, r.data, r.createdAt, r.updatedAt]
  );
}

interface PoolFilter {
  isActive?: boolean;
  testStatus?: string;
}

export async function getProxyPools(filter: PoolFilter = {}): Promise<ProxyPool[]> {
  const db = await getAdapter();
  const where: string[] = [];
  const params: unknown[] = [currentTenantId()];
  if (filter.isActive !== undefined) { where.push("isActive = ?"); params.push(filter.isActive ? 1 : 0); }
  if (filter.testStatus) { where.push("testStatus = ?"); params.push(filter.testStatus); }
  const sql: string = `SELECT * FROM proxyPools WHERE userId = ?${where.length ? ` AND ${where.join(" AND ")}` : ""}`;
  const list: ProxyPool[] = (await db.all(sql, params) as unknown as PoolRow[]).map(rowToPool).filter((p): p is ProxyPool => p !== null);
  list.sort((a: ProxyPool, b: ProxyPool) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
  return list;
}

export async function getProxyPoolById(id: string): Promise<ProxyPool | null> {
  const db = await getAdapter();
  return rowToPool(await db.get(`SELECT * FROM proxyPools WHERE userId = ? AND id = ?`, [currentTenantId(), id]) as PoolRow | undefined);
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
  await upsert(db, pool);
  return pool;
}

export async function updateProxyPool(id: string, data: Partial<ProxyPool>): Promise<ProxyPool | null> {
  const db = await getAdapter();
  let result: ProxyPool | null = null;
  await db.transaction(async () => {
    const row: PoolRow | undefined = await db.get(`SELECT * FROM proxyPools WHERE userId = ? AND id = ?`, [currentTenantId(), id]) as PoolRow | undefined;
    if (!row) return;
    const merged: ProxyPool = { ...rowToPool(row)!, ...data, updatedAt: new Date().toISOString() };
    await upsert(db, merged);
    result = merged;
  });
  return result;
}

export async function deleteProxyPool(id: string): Promise<ProxyPool | null> {
  const db = await getAdapter();
  let removed: ProxyPool | null = null;
  await db.transaction(async () => {
    const row: PoolRow | undefined = await db.get(`SELECT * FROM proxyPools WHERE userId = ? AND id = ?`, [currentTenantId(), id]) as PoolRow | undefined;
    if (!row) return;
    removed = rowToPool(row);
    await db.run(`DELETE FROM proxyPools WHERE userId = ? AND id = ?`, [currentTenantId(), id]);
  });
  return removed;
}

/** Flips `isActive` for several pools in one statement per batch. */
export async function setProxyPoolsActive(ids: string[], isActive: boolean): Promise<number> {
  if (ids.length === 0) return 0;
  const db = await getAdapter();
  const userId = currentTenantId();
  const now = new Date().toISOString();
  let changes = 0;
  await db.transaction(async () => {
    for (const batch of chunked(ids)) {
      changes += (await db.run(
        `UPDATE proxyPools SET isActive = ?, updatedAt = ? WHERE userId = ? AND id IN (${placeholderList(batch.length)})`,
        [isActive ? 1 : 0, now, userId, ...batch],
      )).changes;
    }
  });
  return changes;
}

/**
 * Deletes the pools that nothing is bound to, and reports the rest.
 *
 * A pool in use is refused, exactly as the single-pool route refuses it with a
 * 409 — the caller needs to know which ones survived and why, so the binding
 * check stays part of the delete instead of being left to the caller.
 */
export async function deleteProxyPools(
  ids: string[],
  isBound: (poolId: string) => boolean,
): Promise<{ deleted: string[]; blocked: string[] }> {
  const blocked = ids.filter((id) => isBound(id));
  const deletable = ids.filter((id) => !blocked.includes(id));
  if (deletable.length === 0) return { deleted: [], blocked };

  const db = await getAdapter();
  const userId = currentTenantId();
  await db.transaction(async () => {
    for (const batch of chunked(deletable)) {
      await db.run(
        `DELETE FROM proxyPools WHERE userId = ? AND id IN (${placeholderList(batch.length)})`,
        [userId, ...batch],
      );
    }
  });
  return { deleted: deletable, blocked };
}

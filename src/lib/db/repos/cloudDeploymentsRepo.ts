import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver";
import { currentTenantId } from "../tenant";
import { parseJson, stringifyJson } from "../helpers/jsonCol";

interface DeploymentRow {
  id: string;
  connectionId: string;
  provider: string;
  toolId: string;
  status: string;
  publicUrl: string | null;
  data: string;
  createdAt: string;
  updatedAt: string;
}

export interface CloudDeployment {
  id: string;
  connectionId: string;
  provider: string;
  toolId: string;
  status: "provisioning" | "healthy" | "failed" | "deleting";
  publicUrl: string | null;
  createdAt: string;
  updatedAt: string;
  image: string;
  region: string;
  instanceType: string;
  port: number;
  externalServiceId: string;
  externalDeployId: string | null;
  gatewayToken: string;
  config: Record<string, unknown>;
  error: string | null;
}

function rowToDeployment(row: DeploymentRow | undefined): CloudDeployment | null {
  if (!row) return null;
  const extra = parseJson(row.data, {}) as Record<string, unknown>;
  return {
    id: row.id,
    connectionId: row.connectionId,
    provider: row.provider,
    toolId: row.toolId,
    status: row.status as CloudDeployment["status"],
    publicUrl: row.publicUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    image: (extra.image as string) ?? "",
    region: (extra.region as string) ?? "",
    instanceType: (extra.instanceType as string) ?? "",
    port: (extra.port as number) ?? 0,
    externalServiceId: (extra.externalServiceId as string) ?? "",
    externalDeployId: (extra.externalDeployId as string | null) ?? null,
    gatewayToken: (extra.gatewayToken as string) ?? "",
    config: (extra.config as Record<string, unknown>) ?? {},
    error: (extra.error as string | null) ?? null,
  };
}

function deploymentToRow(d: CloudDeployment): Record<string, unknown> {
  const { id, connectionId, provider, toolId, status, publicUrl, createdAt, updatedAt, ...rest } = d;
  return {
    id,
    connectionId,
    provider,
    toolId,
    status,
    publicUrl: publicUrl ?? null,
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

async function upsert(db: DbLike, d: CloudDeployment): Promise<void> {
  const r = deploymentToRow(d);
  await db.run(
    `INSERT INTO cloudDeployments(id, userId, connectionId, provider, toolId, status, publicUrl, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status=excluded.status, publicUrl=excluded.publicUrl,
       data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, currentTenantId(), r.connectionId, r.provider, r.toolId, r.status, r.publicUrl, r.data, r.createdAt, r.updatedAt]
  );
}

interface DeploymentFilter {
  toolId?: string;
  provider?: string;
}

export async function getCloudDeployments(filter: DeploymentFilter = {}): Promise<CloudDeployment[]> {
  const db = await getAdapter();
  const where: string[] = [];
  const params: unknown[] = [currentTenantId()];
  if (filter.toolId) { where.push("toolId = ?"); params.push(filter.toolId); }
  if (filter.provider) { where.push("provider = ?"); params.push(filter.provider); }
  const sql = `SELECT * FROM cloudDeployments WHERE userId = ?${where.length ? ` AND ${where.join(" AND ")}` : ""}`;
  const list = (await db.all(sql, params) as unknown as DeploymentRow[])
    .map(rowToDeployment)
    .filter((d): d is CloudDeployment => d !== null);
  list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return list;
}

export async function getCloudDeploymentById(id: string): Promise<CloudDeployment | null> {
  const db = await getAdapter();
  return rowToDeployment(await db.get(`SELECT * FROM cloudDeployments WHERE userId = ? AND id = ?`, [currentTenantId(), id]) as DeploymentRow | undefined);
}

interface DeploymentInput {
  connectionId: string;
  provider: string;
  toolId: string;
  status: CloudDeployment["status"];
  publicUrl?: string | null;
  image: string;
  region: string;
  instanceType: string;
  port: number;
  externalServiceId: string;
  externalDeployId?: string | null;
  gatewayToken: string;
  config?: Record<string, unknown>;
  error?: string | null;
}

export async function createCloudDeployment(data: DeploymentInput): Promise<CloudDeployment> {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const deployment: CloudDeployment = {
    id: uuidv4(),
    connectionId: data.connectionId,
    provider: data.provider,
    toolId: data.toolId,
    status: data.status,
    publicUrl: data.publicUrl ?? null,
    image: data.image,
    region: data.region,
    instanceType: data.instanceType,
    port: data.port,
    externalServiceId: data.externalServiceId,
    externalDeployId: data.externalDeployId ?? null,
    gatewayToken: data.gatewayToken,
    config: data.config ?? {},
    error: data.error ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await upsert(db, deployment);
  return deployment;
}

export async function updateCloudDeployment(id: string, data: Partial<CloudDeployment>): Promise<CloudDeployment | null> {
  const db = await getAdapter();
  let result: CloudDeployment | null = null;
  await db.transaction(async () => {
    const row = await db.get(`SELECT * FROM cloudDeployments WHERE userId = ? AND id = ?`, [currentTenantId(), id]) as DeploymentRow | undefined;
    if (!row) return;
    const merged: CloudDeployment = { ...rowToDeployment(row)!, ...data, updatedAt: new Date().toISOString() };
    await upsert(db, merged);
    result = merged;
  });
  return result;
}

export async function deleteCloudDeployment(id: string): Promise<CloudDeployment | null> {
  const db = await getAdapter();
  let removed: CloudDeployment | null = null;
  await db.transaction(async () => {
    const row = await db.get(`SELECT * FROM cloudDeployments WHERE userId = ? AND id = ?`, [currentTenantId(), id]) as DeploymentRow | undefined;
    if (!row) return;
    removed = rowToDeployment(row);
    await db.run(`DELETE FROM cloudDeployments WHERE userId = ? AND id = ?`, [currentTenantId(), id]);
  });
  return removed;
}

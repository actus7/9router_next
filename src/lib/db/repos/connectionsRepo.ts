import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver";
import { currentTenantId } from "../tenant";
import { parseJson, stringifyJson } from "../helpers/jsonCol";
import { decryptConnectionSecrets, encryptConnectionSecrets } from "../helpers/credentialCipher";

const OPTIONAL_FIELDS: string[] = [
  "displayName", "email", "globalPriority", "defaultModel",
  "accessToken", "refreshToken", "expiresAt", "tokenType",
  "scope", "projectId", "apiKey", "testStatus",
  "lastTested", "lastError", "lastErrorAt", "rateLimitedUntil", "expiresIn", "errorCode",
  "consecutiveUseCount", "idToken", "lastRefreshAt",
];

interface ConnectionRow {
  id: string;
  provider: string;
  authType: string;
  name: string | null;
  email: string | null;
  priority: number | null;
  isActive: number | boolean;
  data: string;
  createdAt: string;
  updatedAt: string;
}

interface ProviderConnection {
  id: string;
  provider: string;
  authType: string;
  name: string | null;
  email: string | null;
  priority: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  providerSpecificData?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * The result of a connection test, and nothing else. Earlier versions wrote
 * `success`, `expired` and `unavailable` from several subsystems; the dashboard
 * already bucketed those into connected/error, so normalizing on read keeps
 * every existing row rendering the same while closing the value set.
 * Migration 008 rewrites the stored blobs; this is the safety net.
 */
export type ConnectionTestStatus = "active" | "error" | "unknown";

/**
 * What to record when a credential was just acquired, by OAuth callback, token
 * import or cookie capture. A successful token exchange proves the auth
 * endpoint accepted the grant, not that the provider will serve this account,
 * so it is explicitly not a test result. Those routes use this constant instead
 * of naming a status, which keeps the vocabulary in one place.
 */
export const TEST_STATUS_ON_CREDENTIAL_ACQUIRED: ConnectionTestStatus = "unknown";

/**
 * Status for a key the operator validated in the form before saving. A passing
 * validation really did probe the credential, so it counts as a test result;
 * a failing or skipped one records nothing. Callers pass the fact, not a value.
 */
export function testStatusForValidation(validated: boolean): ConnectionTestStatus {
  return validated ? "active" : TEST_STATUS_ON_CREDENTIAL_ACQUIRED;
}

export function normalizeConnectionTestStatus(value: unknown): ConnectionTestStatus {
  if (value === "active" || value === "success") return "active";
  if (value === "error" || value === "expired" || value === "unavailable") return "error";
  return "unknown";
}

function rowToConn(row: ConnectionRow | undefined): ProviderConnection | null {
  if (!row) return null;
  const extra: Record<string, unknown> = decryptConnectionSecrets(
    parseJson(row.data, {}) as Record<string, unknown>,
  );
  return {
    ...extra,
    testStatus: normalizeConnectionTestStatus(extra.testStatus),
    id: row.id,
    provider: row.provider,
    authType: row.authType,
    name: row.name,
    email: row.email,
    priority: row.priority,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } as ProviderConnection;
}

function connToRow(c: ProviderConnection): Record<string, unknown> {
  const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
  return {
    id,
    provider,
    authType,
    name: name ?? null,
    email: email ?? null,
    priority: priority ?? null,
    isActive: isActive === false ? 0 : 1,
    // The two chokepoints for credential encryption are here and in
    // `rowToConn`. Only the secret fields are transformed; the rest of the blob
    // stays readable so account selection does no cipher work.
    data: stringifyJson(encryptConnectionSecrets(rest as Record<string, unknown>)),
    createdAt,
    updatedAt,
  };
}

interface DbLike {
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  get(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined>;
  all(sql: string, params?: unknown[]): Promise<Array<Record<string, unknown>>>;
}

async function upsert(db: DbLike, c: ProviderConnection): Promise<void> {
  const r = connToRow(c);
  await db.run(
    `INSERT INTO providerConnections(id, userId, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       provider=excluded.provider, authType=excluded.authType, name=excluded.name,
       email=excluded.email, priority=excluded.priority, isActive=excluded.isActive,
       data=excluded.data, updatedAt=excluded.updatedAt
     WHERE providerConnections.userId = excluded.userId`,
    [r.id, currentTenantId(), r.provider, r.authType, r.name, r.email, r.priority, r.isActive, r.data, r.createdAt, r.updatedAt]
  );
}

function deriveConnectionName(data: Record<string, unknown>, fallbackName: string): string {
  if (data.provider === "github") {
    const psd = data.providerSpecificData as Record<string, unknown> | undefined;
    return (psd?.githubLogin as string)
      || (psd?.githubEmail as string)
      || (data.email as string)
      || (psd?.githubName as string)
      || fallbackName;
  }
  return fallbackName;
}

interface ConnectionFilter {
  provider?: string;
  isActive?: boolean;
}

export async function getProviderConnections(filter: ConnectionFilter = {}): Promise<ProviderConnection[]> {
  const db = await getAdapter();
  const where: string[] = [];
  const params: unknown[] = [currentTenantId()];
  if (filter.provider) { where.push("provider = ?"); params.push(filter.provider); }
  if (filter.isActive !== undefined) { where.push("isActive = ?"); params.push(filter.isActive ? 1 : 0); }
  const sql: string = `SELECT * FROM providerConnections WHERE userId = ?${where.length ? ` AND ${where.join(" AND ")}` : ""}`;
  const rows = await db.all(sql, params) as unknown as ConnectionRow[];
  const list: ProviderConnection[] = rows.map(rowToConn).filter((c): c is ProviderConnection => c !== null);
  list.sort((a: ProviderConnection, b: ProviderConnection) => (a.priority || 999) - (b.priority || 999));
  return list;
}

export async function getProviderConnectionById(id: string): Promise<ProviderConnection | null> {
  const db = await getAdapter();
  const row = await db.get(`SELECT * FROM providerConnections WHERE userId = ? AND id = ?`, [currentTenantId(), id]) as ConnectionRow | undefined;
  return rowToConn(row);
}

// Internal sync reorder — must be called INSIDE a transaction
async function reorderInTx(db: DbLike, providerId: string): Promise<void> {
  const userId: string = currentTenantId();
  const list: ProviderConnection[] = (await db.all(`SELECT * FROM providerConnections WHERE userId = ? AND provider = ?`, [userId, providerId]) as unknown as ConnectionRow[]).map(rowToConn).filter((c): c is ProviderConnection => c !== null);
  list.sort((a: ProviderConnection, b: ProviderConnection) => {
    const pDiff: number = (a.priority || 0) - (b.priority || 0);
    if (pDiff !== 0) return pDiff;
    return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
  });
  for (const [i, c] of list.entries()) {
    await db.run(`UPDATE providerConnections SET priority = ? WHERE userId = ? AND id = ?`, [i + 1, userId, c.id]);
  }
}

interface ConnectionInput {
  provider: string;
  authType?: string;
  name?: string;
  email?: string;
  priority?: number;
  isActive?: boolean;
  providerSpecificData?: Record<string, unknown>;
  [key: string]: unknown;
}

export async function createProviderConnection(data: ConnectionInput): Promise<ProviderConnection | undefined> {
  const db = await getAdapter();
  const now: string = new Date().toISOString();
  let result: ProviderConnection | undefined;

  await db.transaction(async () => {
    const all: ProviderConnection[] = (await db.all(`SELECT * FROM providerConnections WHERE userId = ? AND provider = ?`, [currentTenantId(), data.provider]) as unknown as ConnectionRow[]).map(rowToConn).filter((c): c is ProviderConnection => c !== null);

    let existing: ProviderConnection | undefined;
    if (data.authType === "oauth" && data.email) {
      const incomingUsername: string | undefined = data.providerSpecificData?.username as string | undefined;
      const incomingWs: string | undefined = data.providerSpecificData?.chatgptAccountId as string | undefined;
      existing = all.find((c: ProviderConnection) => {
        if (c.authType !== "oauth" || c.email !== data.email) return false;

        if (data.provider === "codex") {
          const existingWs: string | undefined = c.providerSpecificData?.chatgptAccountId as string | undefined;
          return !!incomingWs && !!existingWs && incomingWs === existingWs;
        }

        const existingWs: string | undefined = c.providerSpecificData?.chatgptAccountId as string | undefined;
        if (incomingWs && existingWs) return incomingWs === existingWs;
        if (incomingWs && !existingWs) return false;
        if (!incomingWs && existingWs) return false;
        const existingUsername: string | undefined = c.providerSpecificData?.username as string | undefined;
        if (incomingUsername && existingUsername) {
          return incomingUsername === existingUsername;
        }
        if (incomingUsername || existingUsername) return false;
        return true;
      });
    } else if (data.authType === "apikey" && data.name) {
      existing = all.find((c: ProviderConnection) => c.authType === "apikey" && c.name === data.name);
    }

    if (existing) {
      const merged: ProviderConnection = { ...existing, ...data, updatedAt: now };
      await upsert(db, merged);
      result = merged;
      return;
    }

    let connectionName: string | null = data.name || null;
    if (!connectionName && (data.authType === "oauth" || data.authType === "access_token")) {
      connectionName = deriveConnectionName(data as Record<string, unknown>, data.email || `Account ${all.length + 1}`);
    }
    let connectionPriority: number | undefined = data.priority;
    if (!connectionPriority) {
      connectionPriority = all.reduce((m: number, c: ProviderConnection) => Math.max(m, c.priority || 0), 0) + 1;
    }

    const conn: ProviderConnection = {
      id: uuidv4(),
      provider: data.provider,
      authType: data.authType || "oauth",
      name: connectionName,
      email: data.email ?? null,
      priority: connectionPriority,
      isActive: data.isActive !== undefined ? data.isActive : true,
      createdAt: now,
      updatedAt: now,
    };
    for (const f of OPTIONAL_FIELDS) {
      if ((data as Record<string, unknown>)[f] !== undefined && (data as Record<string, unknown>)[f] !== null) (conn as Record<string, unknown>)[f] = (data as Record<string, unknown>)[f];
    }
    if (data.providerSpecificData && Object.keys(data.providerSpecificData).length > 0) {
      conn.providerSpecificData = data.providerSpecificData;
    }
    if (data.email !== undefined) conn.email = data.email;

    await upsert(db, conn);
    await reorderInTx(db, data.provider);
    result = conn;
  });

  return result;
}

// Critical: OAuth refresh token race — atomic merge inside transaction
export async function updateProviderConnection(id: string, data: Partial<ProviderConnection>): Promise<ProviderConnection | null> {
  const db = await getAdapter();
  let result: ProviderConnection | null;
  await db.transaction(async () => {
  const row = await db.get(`SELECT * FROM providerConnections WHERE userId = ? AND id = ?`, [currentTenantId(), id]) as ConnectionRow | undefined;
    if (!row) { result = null; return; }
    const existing: ProviderConnection = rowToConn(row)!;
    const merged: ProviderConnection = { ...existing, ...data, updatedAt: new Date().toISOString() };
    await upsert(db, merged);
    if (data.priority !== undefined) await reorderInTx(db, existing.provider);
    result = merged;
  });
  return result!;
}

export async function deleteProviderConnection(id: string): Promise<boolean> {
  const db = await getAdapter();
  let ok: boolean = false;
  await db.transaction(async () => {
    const row = await db.get(`SELECT provider FROM providerConnections WHERE userId = ? AND id = ?`, [currentTenantId(), id]) as { provider: string } | undefined;
    if (!row) return;
    await db.run(`DELETE FROM providerConnections WHERE userId = ? AND id = ?`, [currentTenantId(), id]);
    // No FOREIGN KEY exists anywhere in the schema, so the child rows keyed on
    // this connection have to go explicitly. `cleanupExpiredModelAvailability`
    // does not cover them: it only deletes rows whose `until` has passed, and a
    // cooldown written with `until IS NULL` would outlive its connection
    // forever. Done here rather than in the callers because there are two of
    // them (the DELETE route and the server action) and a guard in one leaves
    // the other leaking.
    await db.run(`DELETE FROM modelAvailability WHERE userId = ? AND connectionId = ?`, [currentTenantId(), id]);
    reorderInTx(db, row.provider);
    ok = true;
  });
  return ok;
}

export async function deleteProviderConnectionsByProvider(providerId: string): Promise<number> {
  const db = await getAdapter();
  const userId: string = currentTenantId();
  const before = await db.get(`SELECT COUNT(*) AS n FROM providerConnections WHERE userId = ? AND provider = ?`, [userId, providerId]) as { n: number } | undefined;
  await db.run(`DELETE FROM providerConnections WHERE userId = ? AND provider = ?`, [userId, providerId]);
  return before?.n || 0;
}

export async function reorderProviderConnections(providerId: string): Promise<void> {
  const db = await getAdapter();
  await db.transaction(async () => { await reorderInTx(db, providerId); });
}

export async function cleanupProviderConnections(): Promise<number> {
  const db = await getAdapter();
  const fieldsToCheck: string[] = [
    "displayName", "email", "globalPriority", "defaultModel",
    "accessToken", "refreshToken", "expiresAt", "tokenType",
    "scope", "projectId", "apiKey", "testStatus",
    "lastTested", "lastError", "lastErrorAt", "rateLimitedUntil", "expiresIn",
    "consecutiveUseCount",
  ];
  let cleaned: number = 0;
  await db.transaction(async () => {
    const rows = await db.all(`SELECT * FROM providerConnections WHERE userId = ?`, [currentTenantId()]) as unknown as ConnectionRow[];
    for (const row of rows) {
      const conn: ProviderConnection = rowToConn(row)!;
      let dirty: boolean = false;
      for (const f of fieldsToCheck) {
        if ((conn as Record<string, unknown>)[f] === null || (conn as Record<string, unknown>)[f] === undefined) {
          if (f in conn) { delete (conn as Record<string, unknown>)[f]; cleaned++; dirty = true; }
        }
      }
      if (conn.providerSpecificData && Object.keys(conn.providerSpecificData).length === 0) {
        delete conn.providerSpecificData;
        cleaned++;
        dirty = true;
      }
      if (dirty) await upsert(db, conn);
    }
  });
  return cleaned;
}

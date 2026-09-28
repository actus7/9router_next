import { randomUUID } from "node:crypto";
import { getAdapter } from "../driver";
import { currentTenantId } from "../tenant";
import { stringifyJson } from "../helpers/jsonCol";

// Persistence for the Synapse Loop. Every read and write is scoped to the
// current account: a learned answer is never visible across accounts.

export type CapabilityStatus = "shadow" | "active" | "deprecated";

export interface SynapseCapability {
  id: string;
  key: string;
  personaHash: string;
  canonicalInput: string;
  answer: string;
  status: CapabilityStatus;
  shadowRuns: number;
  shadowAgreements: number;
  served: number;
  rejections: number;
  source: "heuristic" | "jev";
  createdAt: string;
  updatedAt: string;
}

export interface SynapseObservation {
  id: string;
  key: string;
  personaHash: string;
  input: string;
  answer: string;
  model: string | null;
  createdAt: string;
}

const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

function rowToCapability(row: Record<string, unknown>): SynapseCapability {
  return {
    id: String(row.id),
    key: String(row.key),
    personaHash: String(row.personaHash),
    canonicalInput: String(row.canonicalInput),
    answer: String(row.answer),
    status: String(row.status) as CapabilityStatus,
    shadowRuns: num(row.shadowRuns),
    shadowAgreements: num(row.shadowAgreements),
    served: num(row.served),
    rejections: num(row.rejections),
    source: row.source === "jev" ? "jev" : "heuristic",
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

export async function insertObservation(obs: Omit<SynapseObservation, "id" | "createdAt">): Promise<void> {
  const db = await getAdapter();
  await db.run(
    `INSERT INTO synapseObservations(id, userId, key, personaHash, input, answer, model, createdAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), currentTenantId(), obs.key, obs.personaHash, obs.input, obs.answer, obs.model, new Date().toISOString()],
  );
}

export async function listObservations(key: string, personaHash: string, sinceIso: string, limit = 10): Promise<SynapseObservation[]> {
  const db = await getAdapter();
  const rows = (await db.all(
    `SELECT * FROM synapseObservations WHERE userId = ? AND key = ? AND personaHash = ? AND createdAt >= ?
     ORDER BY createdAt DESC LIMIT ?`,
    [currentTenantId(), key, personaHash, sinceIso, limit],
  )) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    key: String(row.key),
    personaHash: String(row.personaHash),
    input: String(row.input),
    answer: String(row.answer),
    model: row.model == null ? null : String(row.model),
    createdAt: String(row.createdAt),
  }));
}

/** Retention: observations older than `beforeIso` are deleted. */
export async function pruneObservations(beforeIso: string): Promise<void> {
  const db = await getAdapter();
  await db.run(`DELETE FROM synapseObservations WHERE userId = ? AND createdAt < ?`, [currentTenantId(), beforeIso]);
}

export async function getCapability(key: string, personaHash: string): Promise<SynapseCapability | null> {
  const db = await getAdapter();
  const row = (await db.get(
    `SELECT * FROM synapseCapabilities WHERE userId = ? AND key = ? AND personaHash = ?`,
    [currentTenantId(), key, personaHash],
  )) as Record<string, unknown> | undefined;
  return row ? rowToCapability(row) : null;
}

export async function getCapabilityById(id: string): Promise<SynapseCapability | null> {
  const db = await getAdapter();
  const row = (await db.get(`SELECT * FROM synapseCapabilities WHERE userId = ? AND id = ?`, [currentTenantId(), id])) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToCapability(row) : null;
}

export async function listCapabilitiesByKey(key: string): Promise<SynapseCapability[]> {
  const db = await getAdapter();
  const rows = (await db.all(`SELECT * FROM synapseCapabilities WHERE userId = ? AND key = ?`, [currentTenantId(), key])) as Array<
    Record<string, unknown>
  >;
  return rows.map(rowToCapability);
}

export async function listCapabilities(): Promise<SynapseCapability[]> {
  const db = await getAdapter();
  const rows = (await db.all(
    `SELECT * FROM synapseCapabilities WHERE userId = ? ORDER BY updatedAt DESC LIMIT 500`,
    [currentTenantId()],
  )) as Array<Record<string, unknown>>;
  return rows.map(rowToCapability);
}

/** Creates the capability in `shadow`; a concurrent twin (same key) is a no-op. */
export async function createShadowCapability(cap: Pick<SynapseCapability, "key" | "personaHash" | "canonicalInput" | "answer" | "source">): Promise<void> {
  const db = await getAdapter();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO synapseCapabilities(id, userId, key, personaHash, canonicalInput, answer, status, shadowRuns, shadowAgreements, served, rejections, source, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?)
     ON CONFLICT(userId, key, personaHash) DO NOTHING`,
    [randomUUID(), currentTenantId(), cap.key, cap.personaHash, cap.canonicalInput, cap.answer, "shadow", cap.source, now, now],
  );
}

type CounterPatch = Partial<Pick<SynapseCapability, "status">> & {
  shadowRuns?: number;
  shadowAgreements?: number;
  served?: number;
  rejections?: number;
};

/** Increments counters and optionally sets the status, atomically in SQL. */
export async function bumpCapability(id: string, patch: CounterPatch): Promise<void> {
  const db = await getAdapter();
  await db.run(
    `UPDATE synapseCapabilities SET
       shadowRuns = shadowRuns + ?, shadowAgreements = shadowAgreements + ?,
       served = served + ?, rejections = rejections + ?,
       status = COALESCE(?, status), updatedAt = ?
     WHERE userId = ? AND id = ?`,
    [
      patch.shadowRuns ?? 0,
      patch.shadowAgreements ?? 0,
      patch.served ?? 0,
      patch.rejections ?? 0,
      patch.status ?? null,
      new Date().toISOString(),
      currentTenantId(),
      id,
    ],
  );
}

/** A rejection: out of use at once, and it has to re-prove itself in shadow. */
export async function demoteToShadow(id: string): Promise<void> {
  const db = await getAdapter();
  await db.run(
    `UPDATE synapseCapabilities SET status = ?, shadowRuns = 0, shadowAgreements = 0,
       rejections = rejections + 1, updatedAt = ? WHERE userId = ? AND id = ?`,
    ["shadow", new Date().toISOString(), currentTenantId(), id],
  );
}

/** Operator actions: reactivate (back to shadow, counters reset) or retire. */
export async function setCapabilityStatus(id: string, status: CapabilityStatus): Promise<void> {
  const db = await getAdapter();
  const reset = status === "shadow" ? ", shadowRuns = 0, shadowAgreements = 0, rejections = 0" : "";
  await db.run(
    `UPDATE synapseCapabilities SET status = ?${reset}, updatedAt = ? WHERE userId = ? AND id = ?`,
    [status, new Date().toISOString(), currentTenantId(), id],
  );
}

export async function deleteCapability(id: string): Promise<void> {
  const db = await getAdapter();
  const userId = currentTenantId();
  await db.transaction(async () => {
    await db.run(`DELETE FROM synapseEvents WHERE userId = ? AND capabilityId = ?`, [userId, id]);
    await db.run(`DELETE FROM synapseCapabilities WHERE userId = ? AND id = ?`, [userId, id]);
  });
}

/** "Forget everything Synapse learned" for this account. */
export async function forgetAllLearning(): Promise<void> {
  const db = await getAdapter();
  const userId = currentTenantId();
  await db.transaction(async () => {
    await db.run(`DELETE FROM synapseEvents WHERE userId = ?`, [userId]);
    await db.run(`DELETE FROM synapseCapabilities WHERE userId = ?`, [userId]);
    await db.run(`DELETE FROM synapseObservations WHERE userId = ?`, [userId]);
  });
}

export async function insertSynapseEvent(capabilityId: string, type: string, payload?: Record<string, unknown>): Promise<void> {
  const db = await getAdapter();
  await db.run(
    `INSERT INTO synapseEvents(id, userId, capabilityId, type, payload, createdAt) VALUES(?, ?, ?, ?, ?, ?)`,
    [randomUUID(), currentTenantId(), capabilityId, type, payload ? stringifyJson(payload) : null, new Date().toISOString()],
  );
}

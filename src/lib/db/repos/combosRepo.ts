import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver";
import { currentTenantId } from "../tenant";
import { parseJson, stringifyJson } from "../helpers/jsonCol";

interface ComboRow {
  id: string;
  name: string;
  kind: string | null;
  models: string;
  routing: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Combo {
  id: string;
  name: string;
  kind: string | null;
  models: unknown[];
  routing: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

function rowToCombo(row: ComboRow | undefined): Combo | null {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    models: parseJson(row.models, []) as unknown[],
    routing: row.routing ? parseJson(row.routing, null) as Record<string, unknown> | null : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getCombos(): Promise<Combo[]> {
  const db = await getAdapter();
  const rows = await db.all(`SELECT * FROM combos WHERE userId = ? ORDER BY createdAt ASC`, [currentTenantId()]) as unknown as ComboRow[];
  return rows.map(rowToCombo).filter((c): c is Combo => c !== null);
}

export async function getComboById(id: string): Promise<Combo | null> {
  const db = await getAdapter();
  const row = await db.get(`SELECT * FROM combos WHERE userId = ? AND id = ?`, [currentTenantId(), id]) as ComboRow | undefined;
  return rowToCombo(row);
}

export async function getComboByName(name: string): Promise<Combo | null> {
  const db = await getAdapter();
  const row = await db.get(`SELECT * FROM combos WHERE userId = ? AND name = ?`, [currentTenantId(), name]) as ComboRow | undefined;
  return rowToCombo(row);
}

interface ComboInput {
  name: string;
  kind?: string | null;
  models?: unknown[];
  routing?: Record<string, unknown> | null;
}

export async function createCombo(data: ComboInput): Promise<Combo> {
  const db = await getAdapter();
  const now: string = new Date().toISOString();
  const combo: Combo = {
    id: uuidv4(),
    name: data.name,
    kind: data.kind || null,
    models: data.models || [],
    routing: data.routing || null,
    createdAt: now,
    updatedAt: now,
  };
  await db.run(
    `INSERT INTO combos(id, userId, name, kind, models, routing, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [combo.id, currentTenantId(), combo.name, combo.kind, stringifyJson(combo.models), combo.routing ? stringifyJson(combo.routing) : null, combo.createdAt, combo.updatedAt]
  );
  return combo;
}

export async function updateCombo(id: string, data: Partial<ComboInput>): Promise<Combo | null> {
  const db = await getAdapter();
  let result: Combo | null = null;
  await db.transaction(async () => {
    const row = await db.get(`SELECT * FROM combos WHERE userId = ? AND id = ?`, [currentTenantId(), id]) as ComboRow | undefined;
    if (!row) return;
    const merged: Combo = { ...rowToCombo(row)!, ...data, updatedAt: new Date().toISOString() };
    await db.run(
      `UPDATE combos SET name = ?, kind = ?, models = ?, routing = ?, updatedAt = ? WHERE userId = ? AND id = ?`,
      [merged.name, merged.kind, stringifyJson(merged.models || []), merged.routing ? stringifyJson(merged.routing) : null, merged.updatedAt, currentTenantId(), id]
    );
    result = merged;
  });
  return result;
}

export async function deleteCombo(id: string): Promise<boolean> {
  const db = await getAdapter();
  const res = await db.run(`DELETE FROM combos WHERE userId = ? AND id = ?`, [currentTenantId(), id]);
  return (res?.changes ?? 0) > 0;
}

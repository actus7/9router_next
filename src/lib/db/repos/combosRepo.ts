import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver";
import { parseJson, stringifyJson } from "../helpers/jsonCol";

interface ComboRow {
  id: string;
  name: string;
  kind: string | null;
  models: string;
  createdAt: string;
  updatedAt: string;
}

interface Combo {
  id: string;
  name: string;
  kind: string | null;
  models: unknown[];
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getCombos(): Promise<Combo[]> {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM combos ORDER BY createdAt ASC`) as unknown as ComboRow[];
  return rows.map(rowToCombo).filter((c): c is Combo => c !== null);
}

export async function getComboById(id: string): Promise<Combo | null> {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]) as ComboRow | undefined;
  return rowToCombo(row);
}

export async function getComboByName(name: string): Promise<Combo | null> {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE name = ?`, [name]) as ComboRow | undefined;
  return rowToCombo(row);
}

interface ComboInput {
  name: string;
  kind?: string | null;
  models?: unknown[];
}

export async function createCombo(data: ComboInput): Promise<Combo> {
  const db = await getAdapter();
  const now: string = new Date().toISOString();
  const combo: Combo = {
    id: uuidv4(),
    name: data.name,
    kind: data.kind || null,
    models: data.models || [],
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
    [combo.id, combo.name, combo.kind, stringifyJson(combo.models), combo.createdAt, combo.updatedAt]
  );
  return combo;
}

export async function updateCombo(id: string, data: Partial<ComboInput>): Promise<Combo | null> {
  const db = await getAdapter();
  let result: Combo | null = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]) as ComboRow | undefined;
    if (!row) return;
    const merged: Combo = { ...rowToCombo(row)!, ...data, updatedAt: new Date().toISOString() };
    db.run(
      `UPDATE combos SET name = ?, kind = ?, models = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.kind, stringifyJson(merged.models || []), merged.updatedAt, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteCombo(id: string): Promise<boolean> {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM combos WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

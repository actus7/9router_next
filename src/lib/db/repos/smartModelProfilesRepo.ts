import { getAdapter } from "../driver";
import { chunked, placeholderList, valuesRows } from "../helpers/batch";
import { currentTenantId } from "../tenant";
import { parseJson, stringifyJson } from "../helpers/jsonCol";
import type { SmartModelProfile } from "@/server/llm-gateway/engine/services/smart-routing/types";

interface ProfileRow {
  modelKey: string;
  inventoryFingerprint: string;
  source: SmartModelProfile["source"];
  profile: string;
  classifierModel: string | null;
  sources: string | null;
  researchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToProfile(row: ProfileRow | undefined): SmartModelProfile | null {
  if (!row) return null;
  const profile = parseJson(row.profile, null) as SmartModelProfile | null;
  if (!profile) return null;
  return {
    ...profile,
    modelKey: row.modelKey,
    inventoryFingerprint: row.inventoryFingerprint,
    source: row.source,
    classifierModel: row.classifierModel,
    sources: parseJson(row.sources, []) as string[],
    researchedAt: row.researchedAt,
    updatedAt: row.updatedAt,
  };
}

export async function getSmartModelProfiles(): Promise<SmartModelProfile[]> {
  const db = await getAdapter();
  const rows = await db.all("SELECT * FROM smartModelProfiles WHERE userId = ? ORDER BY modelKey ASC", [currentTenantId()]) as unknown as ProfileRow[];
  return rows.map(rowToProfile).filter((profile): profile is SmartModelProfile => profile !== null);
}

export async function upsertSmartModelProfiles(profiles: SmartModelProfile[]): Promise<void> {
  if (profiles.length === 0) return;
  const db = await getAdapter();
  const userId = currentTenantId();
  const now = new Date().toISOString();
  await db.transaction(async () => {
    // One SELECT for the whole set, then one INSERT per batch. This ran a
    // SELECT and an INSERT per profile — two Neon round-trips per model, and
    // the caller hands it the whole inventory.
    const keys = profiles.map((profile) => profile.modelKey);
    const createdAtByKey = new Map<string, string>();
    for (const batch of chunked(keys)) {
      const rows = await db.all(
        `SELECT modelKey, createdAt FROM smartModelProfiles WHERE userId = ? AND modelKey IN (${placeholderList(batch.length)})`,
        [userId, ...batch],
      ) as unknown as Array<{ modelKey: string; createdAt?: string }>;
      for (const row of rows) if (row.createdAt) createdAtByKey.set(row.modelKey, row.createdAt);
    }

    for (const batch of chunked(profiles)) {
      await db.run(
        `INSERT INTO smartModelProfiles(
          userId, modelKey, inventoryFingerprint, source, profile, classifierModel,
          sources, researchedAt, createdAt, updatedAt
        ) VALUES ${valuesRows(batch.length, "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")}
        ON CONFLICT(userId, modelKey) DO UPDATE SET
          inventoryFingerprint = excluded.inventoryFingerprint,
          source = excluded.source,
          profile = excluded.profile,
          classifierModel = excluded.classifierModel,
          sources = excluded.sources,
          researchedAt = excluded.researchedAt,
          updatedAt = excluded.updatedAt`,
        batch.flatMap((profile) => [
          userId,
          profile.modelKey,
          profile.inventoryFingerprint,
          profile.source,
          stringifyJson(profile),
          profile.classifierModel || null,
          stringifyJson(profile.sources || []),
          profile.researchedAt || null,
          createdAtByKey.get(profile.modelKey) || now,
          now,
        ]),
      );
    }
  });
}

export async function deleteSmartModelProfiles(modelKeys?: string[]): Promise<number> {
  const db = await getAdapter();
  if (!modelKeys || modelKeys.length === 0) {
    return (await db.run("DELETE FROM smartModelProfiles WHERE userId = ?", [currentTenantId()])).changes;
  }
  let changes = 0;
  await db.transaction(async () => {
    for (const batch of chunked(modelKeys)) {
      changes += (await db.run(
        `DELETE FROM smartModelProfiles WHERE userId = ? AND modelKey IN (${placeholderList(batch.length)})`,
        [currentTenantId(), ...batch],
      )).changes;
    }
  });
  return changes;
}

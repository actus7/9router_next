import { getAdapter } from "../driver";
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

export async function getSmartModelProfile(modelKey: string): Promise<SmartModelProfile | null> {
  const db = await getAdapter();
  return rowToProfile(await db.get("SELECT * FROM smartModelProfiles WHERE userId = ? AND modelKey = ?", [currentTenantId(), modelKey]) as unknown as ProfileRow | undefined);
}

export async function upsertSmartModelProfiles(profiles: SmartModelProfile[]): Promise<void> {
  if (profiles.length === 0) return;
  const db = await getAdapter();
  const now = new Date().toISOString();
  await db.transaction(async () => {
    for (const profile of profiles) {
      const existing = await db.get("SELECT createdAt FROM smartModelProfiles WHERE userId = ? AND modelKey = ?", [currentTenantId(), profile.modelKey]) as { createdAt?: string } | undefined;
      await db.run(
        `INSERT INTO smartModelProfiles(
          userId, modelKey, inventoryFingerprint, source, profile, classifierModel,
          sources, researchedAt, createdAt, updatedAt
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(userId, modelKey) DO UPDATE SET
          inventoryFingerprint = excluded.inventoryFingerprint,
          source = excluded.source,
          profile = excluded.profile,
          classifierModel = excluded.classifierModel,
          sources = excluded.sources,
          researchedAt = excluded.researchedAt,
          updatedAt = excluded.updatedAt`,
        [
          currentTenantId(),
          profile.modelKey,
          profile.inventoryFingerprint,
          profile.source,
          stringifyJson(profile),
          profile.classifierModel || null,
          stringifyJson(profile.sources || []),
          profile.researchedAt || null,
          existing?.createdAt || now,
          now,
        ],
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
    for (const modelKey of modelKeys) {
      changes += (await db.run("DELETE FROM smartModelProfiles WHERE userId = ? AND modelKey = ?", [currentTenantId(), modelKey])).changes;
    }
  });
  return changes;
}

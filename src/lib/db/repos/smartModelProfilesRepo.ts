import { getAdapter } from "../driver";
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
  const rows = db.all("SELECT * FROM smartModelProfiles ORDER BY modelKey ASC") as unknown as ProfileRow[];
  return rows.map(rowToProfile).filter((profile): profile is SmartModelProfile => profile !== null);
}

export async function getSmartModelProfile(modelKey: string): Promise<SmartModelProfile | null> {
  const db = await getAdapter();
  return rowToProfile(db.get("SELECT * FROM smartModelProfiles WHERE modelKey = ?", [modelKey]) as unknown as ProfileRow | undefined);
}

export async function upsertSmartModelProfiles(profiles: SmartModelProfile[]): Promise<void> {
  if (profiles.length === 0) return;
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const profile of profiles) {
      const existing = db.get("SELECT createdAt FROM smartModelProfiles WHERE modelKey = ?", [profile.modelKey]) as { createdAt?: string } | undefined;
      db.run(
        `INSERT OR REPLACE INTO smartModelProfiles(
          modelKey, inventoryFingerprint, source, profile, classifierModel,
          sources, researchedAt, createdAt, updatedAt
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
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
    return db.run("DELETE FROM smartModelProfiles").changes;
  }
  let changes = 0;
  db.transaction(() => {
    for (const modelKey of modelKeys) {
      changes += db.run("DELETE FROM smartModelProfiles WHERE modelKey = ?", [modelKey]).changes;
    }
  });
  return changes;
}

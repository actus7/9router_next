import { getAdapter } from "../driver";

export interface AgentSkillFileRow {
  skillId: string;
  filePath: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

const SKILL_FILE_PATH_PATTERN = /^[a-z0-9][a-z0-9/_.-]{0,127}$/;

export function isValidSkillFilePath(filePath: string): boolean {
  return SKILL_FILE_PATH_PATTERN.test(filePath) && !filePath.includes("..");
}

function rowToFile(row: Record<string, unknown>): AgentSkillFileRow {
  return {
    skillId: String(row.skillId),
    filePath: String(row.filePath),
    content: String(row.content),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

export async function listAgentSkillFiles(skillId: string): Promise<AgentSkillFileRow[]> {
  const db = await getAdapter();
  return db
    .all(
      "SELECT skillId, filePath, content, createdAt, updatedAt FROM agentSkillFiles WHERE skillId = ? ORDER BY filePath",
      [skillId],
    )
    .map(rowToFile);
}

export async function upsertAgentSkillFile(
  row: Omit<AgentSkillFileRow, "createdAt" | "updatedAt">,
): Promise<AgentSkillFileRow> {
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO agentSkillFiles(skillId, filePath, content, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(skillId, filePath) DO UPDATE SET
       content = excluded.content,
       updatedAt = excluded.updatedAt`,
    [row.skillId, row.filePath, row.content, now, now],
  );
  return { ...row, createdAt: now, updatedAt: now };
}

export async function deleteAgentSkillFile(
  skillId: string,
  filePath: string,
): Promise<void> {
  const db = await getAdapter();
  db.run("DELETE FROM agentSkillFiles WHERE skillId = ? AND filePath = ?", [
    skillId,
    filePath,
  ]);
}

export async function deleteAgentSkillFilesForSkill(skillId: string): Promise<void> {
  const db = await getAdapter();
  db.run("DELETE FROM agentSkillFiles WHERE skillId = ?", [skillId]);
}

export async function replaceAgentSkillFiles(
  skillId: string,
  files: Array<{ filePath: string; content: string }>,
): Promise<void> {
  const db = await getAdapter();
  db.transaction(() => {
    db.run("DELETE FROM agentSkillFiles WHERE skillId = ?", [skillId]);
    const now = new Date().toISOString();
    for (const file of files) {
      db.run(
        `INSERT INTO agentSkillFiles(skillId, filePath, content, createdAt, updatedAt)
         VALUES(?, ?, ?, ?, ?)`,
        [skillId, file.filePath, file.content, now, now],
      );
    }
  });
}

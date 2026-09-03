interface DbAdapter {
  exec(sql: string): void;
}

export default {
  version: 6,
  name: "agent-skill-files",
  up(db: DbAdapter): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agentSkillFiles (
        skillId TEXT NOT NULL,
        filePath TEXT NOT NULL,
        content TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        PRIMARY KEY (skillId, filePath)
      );
      CREATE INDEX IF NOT EXISTS idx_asf_skill ON agentSkillFiles(skillId);
    `);
  },
};

interface DbAdapter {
  exec(sql: string): void;
}

export default {
  version: 3,
  name: "harness-conversations",
  up(db: DbAdapter): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS harnessConversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        projectId TEXT,
        providerId TEXT,
        modelId TEXT,
        data TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_hc_updated ON harnessConversations(updatedAt DESC);
      CREATE INDEX IF NOT EXISTS idx_hc_project ON harnessConversations(projectId);
      CREATE TABLE IF NOT EXISTS harnessEvents (
        sessionId TEXT NOT NULL,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        PRIMARY KEY (sessionId, seq)
      );
      CREATE INDEX IF NOT EXISTS idx_he_session_seq ON harnessEvents(sessionId, seq);
      CREATE INDEX IF NOT EXISTS idx_he_type ON harnessEvents(type);
    `);
  },
};

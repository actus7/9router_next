interface DbAdapter {
  exec(sql: string): void;
  all(sql: string, params?: unknown[]): Array<Record<string, unknown>>;
  run(sql: string, params?: unknown[]): { changes: number; lastInsertRowid: number | null };
  transaction(fn: () => void): void;
}

function extractText(dataRaw: unknown): string {
  if (typeof dataRaw !== "string") return "";
  try {
    const data = JSON.parse(dataRaw) as Record<string, unknown>;
    return typeof data.content === "string" ? data.content.trim() : "";
  } catch {
    return "";
  }
}

export default {
  version: 5,
  name: "harness-message-fts",
  up(db: DbAdapter): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS harnessMessageIndex (
        sessionId TEXT NOT NULL,
        messageId TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        PRIMARY KEY (sessionId, messageId)
      );
      CREATE INDEX IF NOT EXISTS idx_hmi_created ON harnessMessageIndex(createdAt DESC);
      CREATE VIRTUAL TABLE IF NOT EXISTS harnessMessageFts USING fts5(
        sessionId UNINDEXED,
        messageId UNINDEXED,
        role UNINDEXED,
        content,
        createdAt UNINDEXED,
        tokenize = 'unicode61'
      );
    `);

    const rows = db.all(
      `SELECT sessionId, seq, type, data, createdAt FROM harnessEvents
       WHERE type IN ('user/message', 'assistant/message')`,
    );
    db.transaction(() => {
      for (const row of rows) {
        const content = extractText(row.data);
        if (!content) continue;
        const sessionId = String(row.sessionId);
        const data = JSON.parse(String(row.data)) as Record<string, unknown>;
        const messageId =
          typeof data.messageId === "string"
            ? data.messageId
            : typeof data.runId === "string"
              ? data.runId
              : `${sessionId}-${row.seq}`;
        const role = String(row.type).startsWith("user/") ? "user" : "assistant";
        const createdAt = String(row.createdAt);
        db.run(
          `INSERT OR REPLACE INTO harnessMessageIndex(sessionId, messageId, role, content, createdAt)
           VALUES(?, ?, ?, ?, ?)`,
          [sessionId, messageId, role, content.slice(0, 12_000), createdAt],
        );
        db.run(`DELETE FROM harnessMessageFts WHERE sessionId = ? AND messageId = ?`, [
          sessionId,
          messageId,
        ]);
        db.run(
          `INSERT INTO harnessMessageFts(sessionId, messageId, role, content, createdAt)
           VALUES(?, ?, ?, ?, ?)`,
          [sessionId, messageId, role, content.slice(0, 12_000), createdAt],
        );
      }
    });
  },
};

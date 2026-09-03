import { getAdapter } from "../driver";

export interface IndexedHarnessMessage {
  sessionId: string;
  messageId: string;
  role: string;
  content: string;
  createdAt: string;
}

export interface SessionSearchHit {
  sessionId: string;
  messageId: string;
  role: string;
  snippet: string;
  createdAt: string;
}

export async function upsertHarnessMessageIndex(
  entry: IndexedHarnessMessage,
): Promise<void> {
  const db = await getAdapter();
  const content = entry.content.trim().slice(0, 12_000);
  if (!content) return;
  db.transaction(() => {
    db.run(
      `INSERT OR REPLACE INTO harnessMessageIndex(sessionId, messageId, role, content, createdAt)
       VALUES(?, ?, ?, ?, ?)`,
      [entry.sessionId, entry.messageId, entry.role, content, entry.createdAt],
    );
    db.run(`DELETE FROM harnessMessageFts WHERE sessionId = ? AND messageId = ?`, [
      entry.sessionId,
      entry.messageId,
    ]);
    db.run(
      `INSERT INTO harnessMessageFts(sessionId, messageId, role, content, createdAt)
       VALUES(?, ?, ?, ?, ?)`,
      [entry.sessionId, entry.messageId, entry.role, content, entry.createdAt],
    );
  });
}

export async function searchPastSessionMessages(options: {
  query: string;
  limit?: number;
  excludeSessionId?: string;
}): Promise<SessionSearchHit[]> {
  const db = await getAdapter();
  const trimmed = options.query.trim();
  if (!trimmed) return [];
  const limit = Math.max(1, Math.min(20, options.limit ?? 8));
  const ftsQuery = trimmed
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replaceAll('"', "")}"`)
    .join(" AND ");
  const rows = options.excludeSessionId
    ? db.all(
        `SELECT sessionId, messageId, role,
                snippet(harnessMessageFts, 2, '>>', '<<', '…', 48) AS snippet,
                createdAt
         FROM harnessMessageFts
         WHERE harnessMessageFts MATCH ? AND sessionId != ?
         ORDER BY rank
         LIMIT ?`,
        [ftsQuery, options.excludeSessionId, limit],
      )
    : db.all(
        `SELECT sessionId, messageId, role,
                snippet(harnessMessageFts, 2, '>>', '<<', '…', 48) AS snippet,
                createdAt
         FROM harnessMessageFts
         WHERE harnessMessageFts MATCH ?
         ORDER BY rank
         LIMIT ?`,
        [ftsQuery, limit],
      );
  return rows.map((row) => ({
    sessionId: String(row.sessionId),
    messageId: String(row.messageId),
    role: String(row.role),
    snippet: String(row.snippet ?? ""),
    createdAt: String(row.createdAt),
  }));
}

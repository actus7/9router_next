import { getAdapter } from "../driver";
import { currentTenantId } from "../tenant";

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
  // One statement, no companion table: `contentTsv` is a generated column, so
  // the search index cannot drift from the row it indexes. SQLite needed a
  // separate FTS5 table kept in sync by hand inside a transaction.
  await db.run(
    `INSERT INTO harnessMessageIndex(userId, sessionId, messageId, role, content, createdAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(userId, sessionId, messageId) DO UPDATE SET
       role = excluded.role,
       content = excluded.content,
       createdAt = excluded.createdAt`,
    [currentTenantId(), entry.sessionId, entry.messageId, entry.role, content, entry.createdAt],
  );
}

export async function searchPastSessionMessages(options: {
  query: string;
  limit?: number;
  excludeSessionId?: string;
}): Promise<SessionSearchHit[]> {
  const trimmed = options.query.trim();
  if (!trimmed) return [];
  const db = await getAdapter();
  const limit = Math.max(1, Math.min(20, options.limit ?? 8));
  // `plainto_tsquery` ANDs the terms it finds, which is what the hand-built
  // FTS5 `"a" AND "b"` string did — and it takes the user's text directly
  // instead of quoting each term, so a stray quote cannot change the query.
  const headline =
    `ts_headline('simple', content, plainto_tsquery('simple', ?), ` +
    `'StartSel=>>, StopSel=<<, MaxWords=48, MinWords=20, MaxFragments=1')`;
  const params: unknown[] = options.excludeSessionId
    ? [trimmed, currentTenantId(), trimmed, options.excludeSessionId, trimmed, limit]
    : [trimmed, currentTenantId(), trimmed, trimmed, limit];
  const rows = await db.all(
    `SELECT sessionId, messageId, role, ${headline} AS snippet, createdAt
     FROM harnessMessageIndex
     WHERE userId = ? AND contentTsv @@ plainto_tsquery('simple', ?)
       ${options.excludeSessionId ? "AND sessionId != ?" : ""}
     ORDER BY ts_rank(contentTsv, plainto_tsquery('simple', ?)) DESC
     LIMIT ?`,
    params,
  );
  return rows.map((row) => ({
    sessionId: String(row.sessionId),
    messageId: String(row.messageId),
    role: String(row.role),
    snippet: String(row.snippet ?? ""),
    createdAt: String(row.createdAt),
  }));
}

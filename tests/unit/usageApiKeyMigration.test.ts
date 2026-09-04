import { describe, expect, it } from "vitest";

import migration009 from "@/lib/db/migrations/009-usage-api-key-id";

interface HistoryRow {
  id: number;
  apiKey: string | null;
}
interface DailyRow {
  dateKey: string;
  data: string;
}

/**
 * usageHistory has no pruning, so a raw API key written there outlives every
 * rotation. The same secret is also embedded in the usageDaily aggregate — both
 * as part of the composite map key and inside its `meta` — so both have to be
 * rewritten to the key's row id.
 *
 * The migration runs inside a transaction. Anything it throws rolls back every
 * other row and pins the install at the previous schema version, failing again
 * on each boot — which is exactly how migration 008 nearly bricked installs. A
 * single malformed row must therefore never throw.
 */
function fakeDb(history: HistoryRow[], daily: DailyRow[], keys: Array<{ id: string; key: string }>) {
  const writes: Array<{ sql: string; params: unknown[] }> = [];
  return {
    writes,
    all: (sql: string) => {
      if (sql.includes("FROM apiKeys")) return keys.map((k) => ({ ...k }) as Record<string, unknown>);
      if (sql.includes("FROM usageDaily")) return daily.map((d) => ({ ...d }) as Record<string, unknown>);
      return history.map((h) => ({ ...h }) as Record<string, unknown>);
    },
    run: (sql: string, params?: unknown[]) => {
      writes.push({ sql, params: params ?? [] });
      return { changes: 1 };
    },
  };
}

const KEYS = [{ id: "key-uuid-1", key: "sk-machine-abc123-deadbeef" }];

describe("migration 009: usage api key id", () => {
  it("replaces the raw key in usageHistory with the key row id", () => {
    const db = fakeDb([{ id: 1, apiKey: "sk-machine-abc123-deadbeef" }], [], KEYS);

    migration009.up(db);

    const write = db.writes.find((w) => w.sql.includes("UPDATE usageHistory"));
    expect(write).toBeDefined();
    expect(write!.params).toEqual(["key-uuid-1", 1]);
  });

  it("leaves a row alone when its value is already the row id", () => {
    const db = fakeDb([{ id: 1, apiKey: "key-uuid-1" }], [], KEYS);

    migration009.up(db);

    expect(db.writes.filter((w) => w.sql.includes("UPDATE usageHistory"))).toEqual([]);
  });

  it("keeps an unrecognised key verbatim rather than losing the attribution", () => {
    const db = fakeDb([{ id: 1, apiKey: "sk-some-deleted-key" }], [], KEYS);

    migration009.up(db);

    expect(db.writes.filter((w) => w.sql.includes("UPDATE usageHistory"))).toEqual([]);
  });

  it("rewrites the raw key inside the usageDaily aggregate, map key included", () => {
    const day = {
      requests: 2,
      byApiKey: {
        "sk-machine-abc123-deadbeef|gpt-4|openai": {
          requests: 2,
          meta: { rawModel: "gpt-4", provider: "openai", apiKey: "sk-machine-abc123-deadbeef" },
        },
      },
    };
    const db = fakeDb([], [{ dateKey: "2026-09-04", data: JSON.stringify(day) }], KEYS);

    migration009.up(db);

    const write = db.writes.find((w) => w.sql.includes("UPDATE usageDaily"));
    expect(write).toBeDefined();
    const rewritten = JSON.parse(String(write!.params[0]));
    expect(Object.keys(rewritten.byApiKey)).toEqual(["key-uuid-1|gpt-4|openai"]);
    expect(rewritten.byApiKey["key-uuid-1|gpt-4|openai"].meta.apiKey).toBe("key-uuid-1");
    // Untouched counters prove the rewrite did not rebuild the aggregate.
    expect(rewritten.requests).toBe(2);
  });

  it("skips blobs that are not objects without throwing", () => {
    // JSON.parse succeeds on all of these, so a parse try/catch does not cover
    // them: "null" yields null, and reading a property off it throws.
    const db = fakeDb(
      [{ id: 1, apiKey: null }, { id: 2, apiKey: "" }],
      [
        { dateKey: "d1", data: "null" },
        { dateKey: "d2", data: "42" },
        { dateKey: "d3", data: '"text"' },
        { dateKey: "d4", data: "[]" },
        { dateKey: "d5", data: "{not json" },
      ],
      KEYS,
    );

    expect(() => migration009.up(db)).not.toThrow();
    expect(db.writes).toEqual([]);
  });

  it("tolerates a byApiKey that is not an object", () => {
    const db = fakeDb([], [{ dateKey: "d1", data: JSON.stringify({ byApiKey: "nope" }) }], KEYS);

    expect(() => migration009.up(db)).not.toThrow();
  });
});

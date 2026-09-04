import { describe, expect, it } from "vitest";

import migration008 from "@/lib/db/migrations/008-connection-test-status";

interface Row {
  id: string;
  data: string;
}

/**
 * The migration runs inside a transaction, so anything it throws rolls the
 * whole step back and leaves the install pinned at the previous schema
 * version, retrying — and failing — on every boot. A single malformed row
 * must therefore never be able to throw.
 */
function fakeDb(rows: Row[]) {
  const writes: Array<{ id: string; data: string }> = [];
  return {
    writes,
    all: () => rows.map((row) => ({ ...row }) as Record<string, unknown>),
    run: (_sql: string, params?: unknown[]) => {
      writes.push({ data: String(params?.[0]), id: String(params?.[2]) });
      return { changes: 1 };
    },
  };
}

describe("migration 008: connection test status", () => {
  it("maps a legacy status and leaves the credentials in the blob untouched", () => {
    const db = fakeDb([
      { id: "c1", data: JSON.stringify({ testStatus: "success", apiKey: "sk-secret", extra: 1 }) },
    ]);

    migration008.up(db);

    expect(db.writes).toHaveLength(1);
    expect(JSON.parse(db.writes[0]!.data)).toEqual({
      testStatus: "active",
      apiKey: "sk-secret",
      extra: 1,
    });
  });

  it("leaves a row alone when the status is already in the closed set", () => {
    const db = fakeDb([{ id: "c1", data: JSON.stringify({ testStatus: "active" }) }]);

    migration008.up(db);

    expect(db.writes).toEqual([]);
  });

  it("turns an unrecognized status into unknown rather than guessing", () => {
    const db = fakeDb([{ id: "c1", data: JSON.stringify({ testStatus: "usage" }) }]);

    migration008.up(db);

    expect(JSON.parse(db.writes[0]!.data).testStatus).toBe("unknown");
  });

  it("skips a row whose blob is not an object without throwing", () => {
    // JSON.parse succeeds on all three, so the parse try/catch never fires:
    // "null" yields null, and reading a property off it throws a TypeError
    // that would roll back the migration for every other row too.
    const db = fakeDb([
      { id: "c1", data: "null" },
      { id: "c2", data: "42" },
      { id: "c3", data: '"a string"' },
      { id: "c4", data: "[]" },
      { id: "c5", data: JSON.stringify({ testStatus: "expired" }) },
    ]);

    expect(() => migration008.up(db)).not.toThrow();

    // The one good row still gets migrated, so a bad neighbour cannot
    // silently cost the rest of the table its normalization.
    expect(db.writes).toEqual([
      { id: "c5", data: JSON.stringify({ testStatus: "error" }) },
    ]);
  });

  it("skips malformed JSON", () => {
    const db = fakeDb([{ id: "c1", data: "{not json" }]);

    expect(() => migration008.up(db)).not.toThrow();
    expect(db.writes).toEqual([]);
  });
});

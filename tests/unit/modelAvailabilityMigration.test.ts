import migration from "@/lib/db/migrations/004-model-availability";
import { describe, expect, it } from "vitest";

describe("model availability migration", () => {
  it("moves legacy model locks once and removes them from connection JSON", () => {
    const runs: Array<{ sql: string; params?: unknown[] }> = [];
    const adapter = {
      exec: () => undefined,
      all: () => [{ id: "connection-1", data: JSON.stringify({ modelLock_modelA: "2099-01-01T00:00:00.000Z", modelLock_expired: "2000-01-01T00:00:00.000Z", lastError: "legacy error", errorCode: 429 }) }],
      run: (sql: string, params?: unknown[]) => { runs.push({ sql, params }); return { changes: 1 }; },
    };

    migration.up(adapter);

    const insert = runs.find(({ sql }) => sql.includes("INSERT INTO modelAvailability"));
    expect(insert?.sql).toContain("'cooldown', 'legacy'");
    expect(insert?.params).toEqual(expect.arrayContaining(["connection-1", "modelA", 429, "legacy error"]));
    expect(runs.filter(({ sql }) => sql.includes("INSERT INTO modelAvailability"))).toHaveLength(1);
    const update = runs.find(({ sql }) => sql.includes("UPDATE providerConnections"));
    expect(JSON.parse(String(update?.params?.[0]))).toEqual({ lastError: "legacy error", errorCode: 429 });
  });

  it("is idempotent when a connection no longer has legacy locks", () => {
    const runs: Array<{ sql: string; params?: unknown[] }> = [];
    migration.up({
      exec: () => undefined,
      all: () => [{ id: "connection-1", data: JSON.stringify({ lastError: "kept" }) }],
      run: (sql: string, params?: unknown[]) => { runs.push({ sql, params }); return { changes: 1 }; },
    });
    expect(runs).toEqual([]);
  });
});

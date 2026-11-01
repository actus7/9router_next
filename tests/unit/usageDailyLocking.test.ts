import { beforeEach, describe, expect, it, vi } from "vitest";

const log = vi.hoisted(() => ({ sql: [] as string[] }));
const run = vi.hoisted(() => vi.fn());
const get = vi.hoisted(() => vi.fn());
const transaction = vi.hoisted(() => vi.fn(async (fn: () => Promise<unknown>) => fn()));

vi.mock("@/lib/db/driver", () => ({
  getAdapter: vi.fn(async () => ({ run, get, transaction })),
}));
vi.mock("@/lib/db/tenant", () => ({
  currentTenantId: () => "tenant-1",
  tryCurrentTenantContext: () => ({ actorUserId: "tenant-1" }),
}));

import { bumpTenantMeta } from "@/lib/db/helpers/tenantMeta";
import { saveRequestUsage } from "@/lib/db/repos/usageRepo";

const normalize = (sql: unknown): string => String(sql).replace(/\s+/g, " ");

describe("bumpTenantMeta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    log.sql = [];
    get.mockImplementation(async (sql: unknown) => {
      log.sql.push(normalize(sql));
      return { value: "7" };
    });
  });

  it("increments in one atomic upsert and returns the new value", async () => {
    const next = await bumpTenantMeta({ run, get, transaction } as never, "x");

    expect(next).toBe(7);
    expect(log.sql).toHaveLength(1);
    expect(log.sql[0]).toContain("ON CONFLICT");
    expect(log.sql[0]).toContain("RETURNING value");
    expect(log.sql.some((sql) => sql.includes("SELECT value FROM kv"))).toBe(false);
  });
});

describe("saveRequestUsage daily aggregate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    log.sql = [];
    run.mockImplementation(async (sql: unknown) => {
      log.sql.push(normalize(sql));
      return { changes: 1 };
    });
    get.mockImplementation(async (sql: unknown) => {
      const text = normalize(sql);
      log.sql.push(text);
      if (text.includes("INSERT INTO usageHistory")) return { id: 1 };
      if (text.includes("FROM usageDaily")) return { data: "{}" };
      if (text.includes("INSERT INTO kv")) return { value: "1" };
      return undefined;
    });
  });

  it("creates the day row, then locks it, before reading the blob", async () => {
    await saveRequestUsage({ timestamp: "2026-10-31T12:00:00.000Z", tokens: {}, status: "ok" } as never);

    const insert = log.sql.findIndex((sql) => sql.includes("INSERT INTO usageDaily") && sql.includes("DO NOTHING"));
    const lock = log.sql.findIndex((sql) => sql.includes("SELECT data FROM usageDaily") && sql.includes("FOR UPDATE"));
    expect(insert).toBeGreaterThanOrEqual(0);
    expect(lock).toBeGreaterThan(insert);
  });
});

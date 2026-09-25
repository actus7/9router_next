import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/helpers/credentialCipher", () => ({
  assertCredentialEncryptionPolicy: vi.fn(),
  isCredentialEncryptionEnabled: () => true,
}));

import { runMigrationOnce, __test__ } from "@/lib/db/migrate";
import type { DbAdapter } from "@/lib/db/driver";

/**
 * A cold start used to run the whole additive sync — ~90 sequential round
 * trips — before the first request of every instance could touch the database.
 * The sync is now skipped when `_meta` already holds this build's schema hash.
 */
function fakeAdapter(meta: Map<string, string>, failDdl = false): { adapter: DbAdapter; ddl: string[] } {
  const ddl: string[] = [];
  const adapter = {
    exec: vi.fn(async (sql: string) => {
      ddl.push(sql);
      if (failDdl && sql.startsWith("ALTER")) throw new Error("column cannot be NOT NULL");
    }),
    get: vi.fn(async () => ({ present: 1 })),
    // Report every table as having no columns, so a sync emits ALTERs.
    all: vi.fn(async (sql: string) => {
      if (sql.includes("FROM _meta")) return [...meta].map(([key, value]) => ({ key, value }));
      return [];
    }),
    run: vi.fn(async (_sql: string, params: string[]) => {
      for (let i = 0; i < params.length; i += 2) meta.set(params[i], params[i + 1]);
    }),
  } as unknown as DbAdapter;
  return { adapter, ddl };
}

describe("runMigrationOnce schema hash", () => {
  it("syncs a database that has no hash yet, then records it", async () => {
    const meta = new Map<string, string>();
    const { adapter, ddl } = fakeAdapter(meta);
    await runMigrationOnce(adapter);
    expect(ddl.length).toBeGreaterThan(0);
    expect(meta.get("schemaHash")).toBe(__test__.schemaHash());
  });

  it("skips the sync entirely when the stored hash matches", async () => {
    const meta = new Map<string, string>([["schemaHash", __test__.schemaHash()]]);
    const { adapter, ddl } = fakeAdapter(meta);
    await runMigrationOnce(adapter);
    expect(ddl).toEqual([]);
    expect(vi.mocked(adapter.all)).toHaveBeenCalledTimes(1);
  });

  it("syncs again when the declared schema changed (hash differs)", async () => {
    const meta = new Map<string, string>([["schemaHash", "an-older-schema"]]);
    const { adapter, ddl } = fakeAdapter(meta);
    await runMigrationOnce(adapter);
    expect(ddl.length).toBeGreaterThan(0);
    expect(meta.get("schemaHash")).toBe(__test__.schemaHash());
  });

  it("does not record the hash when part of the sync failed, so the next boot retries", async () => {
    const meta = new Map<string, string>();
    const { adapter } = fakeAdapter(meta, true);
    await runMigrationOnce(adapter);
    expect(meta.has("schemaHash")).toBe(false);
  });
});

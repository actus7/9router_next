import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TABLES, buildCreateTableSql } from "@/lib/db/schema";
import { MIGRATIONS } from "@/lib/db/migrations";
import {
  __resetCredentialKeyCache,
  isEncryptedValue,
} from "@/lib/db/helpers/credentialCipher";

/**
 * The migration unit tests all drive fake adapters, which proves the logic but
 * not that the SQL runs. These exercise migrations 009 and 010 against a real
 * SQLite database with real rows, because that is the failure that actually
 * hurts: a migration runs inside a transaction, so a bad statement rolls back
 * every row and pins the install at the previous schema version — failing again
 * on every boot, which is what migration 008 nearly did.
 *
 * Uses better-sqlite3 in-memory, the same driver the app prefers.
 */
type Stmt = {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
};
type Db = {
  prepare(sql: string): Stmt;
  exec(sql: string): unknown;
  /** better-sqlite3 only; node:sqlite gets SAVEPOINT nesting instead. */
  transaction?(fn: () => void): () => void;
  close(): void;
};

interface Adapter {
  all(sql: string, params?: unknown[]): Array<Record<string, unknown>>;
  run(sql: string, params?: unknown[]): { changes: number };
  get(sql: string, params?: unknown[]): Record<string, unknown> | undefined;
  // Earlier migrations (001-007) create tables and add columns through exec.
  exec(sql: string): void;
  transaction(fn: () => void): void;
}

let db: Db;

function adapterFor(database: Db): Adapter {
  return {
    all: (sql, params = []) =>
      database.prepare(sql).all(...params) as Array<Record<string, unknown>>,
    run: (sql, params = []) => {
      const info = database.prepare(sql).run(...params) as { changes?: number };
      return { changes: info?.changes ?? 0 };
    },
    get: (sql, params = []) =>
      database.prepare(sql).get(...params) as Record<string, unknown> | undefined,
    exec: (sql) => {
      database.exec(sql);
    },
    // Mirrors whichever adapter the app would use. Nesting matters here:
    // migration 005 opens its own transaction inside an `up()` that the runner
    // has already wrapped. better-sqlite3 handles that itself; node:sqlite has
    // no wrapper, so nodeSqliteAdapter uses SAVEPOINT and so does this. A
    // hand-rolled BEGIN/COMMIT would fail on the nesting and report a bug
    // production does not have.
    transaction: (fn) => {
      if (database.transaction) {
        database.transaction(fn)();
        return;
      }
      const sp = `sp_${Math.random().toString(36).slice(2)}`;
      database.exec(`SAVEPOINT ${sp}`);
      try {
        fn();
        database.exec(`RELEASE ${sp}`);
      } catch (error) {
        database.exec(`ROLLBACK TO ${sp}`);
        database.exec(`RELEASE ${sp}`);
        throw error;
      }
    },
  };
}

function migration(version: number) {
  const found = MIGRATIONS.find((m) => m.version === version);
  if (!found) throw new Error(`migration ${version} is not registered`);
  return found;
}

/**
 * The app prefers better-sqlite3 and falls back to node:sqlite, so the test
 * does the same. better-sqlite3 is an optionalDependency — an install that
 * cannot build the native module still runs the app, so a test that hard-required
 * it would fail CI for an environment the app supports.
 */
async function openMemoryDb(): Promise<Db | null> {
  try {
    const { default: Database } = await import("better-sqlite3");
    return new Database(":memory:") as unknown as Db;
  } catch {
    /* fall through to the built-in driver */
  }
  try {
    const { DatabaseSync } = await import("node:sqlite");
    return new DatabaseSync(":memory:") as unknown as Db;
  } catch {
    return null;
  }
}

beforeEach(async () => {
  const opened = await openMemoryDb();
  // Neither driver available means the verification is not running, which must
  // be loud rather than a silently green suite.
  if (!opened) throw new Error("no SQLite driver available (better-sqlite3 or node:sqlite required)");
  db = opened;
  for (const [name, def] of Object.entries(TABLES)) {
    db.exec(buildCreateTableSql(name, def));
  }
  process.env.CREDENTIAL_KEY = "real-db-test-key";
  __resetCredentialKeyCache();
});

afterEach(() => {
  delete process.env.CREDENTIAL_KEY;
  __resetCredentialKeyCache();
  db.close();
});

describe("migration 009 against a real database", () => {
  it("rewrites the raw key in both usage tables and commits", () => {
    const adapter = adapterFor(db);
    db.prepare(
      "INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, 1, ?)",
    ).run("key-1", "sk-machine-aaaaaa-deadbeef", "Default", "machine", "2026-01-01");
    db.prepare(
      "INSERT INTO usageHistory(timestamp, provider, model, apiKey, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, 1, 1, 0, 'ok', '{}', '{}')",
    ).run("2026-09-04T00:00:00.000Z", "openai", "gpt-4o", "sk-machine-aaaaaa-deadbeef");
    db.prepare("INSERT INTO usageDaily(dateKey, data) VALUES(?, ?)").run(
      "2026-09-04",
      JSON.stringify({
        requests: 1,
        byApiKey: {
          "sk-machine-aaaaaa-deadbeef|gpt-4o|openai": {
            requests: 1,
            meta: { apiKey: "sk-machine-aaaaaa-deadbeef" },
          },
        },
      }),
    );

    adapter.transaction(() => migration(9).up(adapter));

    const history = db
      .prepare("SELECT apiKey FROM usageHistory")
      .get() as { apiKey: string };
    expect(history.apiKey).toBe("key-1");

    const daily = db.prepare("SELECT data FROM usageDaily").get() as { data: string };
    const parsed = JSON.parse(daily.data);
    expect(Object.keys(parsed.byApiKey)).toEqual(["key-1|gpt-4o|openai"]);
    expect(parsed.byApiKey["key-1|gpt-4o|openai"].meta.apiKey).toBe("key-1");
    expect(parsed.requests).toBe(1);

    // No raw key survives anywhere in the usage tables.
    const dump = JSON.stringify([
      db.prepare("SELECT * FROM usageHistory").all(),
      db.prepare("SELECT * FROM usageDaily").all(),
    ]);
    expect(dump).not.toContain("sk-machine-aaaaaa-deadbeef");
  });

  it("commits the good rows even with malformed neighbours in the table", () => {
    const adapter = adapterFor(db);
    db.prepare(
      "INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, 1, ?)",
    ).run("key-1", "sk-good", "Default", "machine", "2026-01-01");
    for (const [i, data] of ["null", "42", '"text"', "[]", "{not json"].entries()) {
      db.prepare("INSERT INTO usageDaily(dateKey, data) VALUES(?, ?)").run(`bad-${i}`, data);
    }
    db.prepare(
      "INSERT INTO usageHistory(timestamp, provider, model, apiKey, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, 'openai', 'gpt-4o', ?, 1, 1, 0, 'ok', '{}', '{}')",
    ).run("2026-09-04T00:00:00.000Z", "sk-good");

    expect(() => adapter.transaction(() => migration(9).up(adapter))).not.toThrow();

    const history = db.prepare("SELECT apiKey FROM usageHistory").get() as { apiKey: string };
    expect(history.apiKey).toBe("key-1");
  });
});

describe("migration 010 against a real database", () => {
  it("encrypts credentials in place and leaves the rest of the blob readable", () => {
    const adapter = adapterFor(db);
    db.prepare(
      "INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, 'openai', 'apikey', 'Acct', 'a@b.c', 1, 1, ?, ?, ?)",
    ).run(
      "conn-1",
      JSON.stringify({ apiKey: "sk-upstream-plain", email: "a@b.c", testStatus: "active" }),
      "2026-01-01",
      "2026-01-01",
    );

    adapter.transaction(() => migration(10).up(adapter));

    const row = db.prepare("SELECT data FROM providerConnections").get() as { data: string };
    const parsed = JSON.parse(row.data);
    expect(isEncryptedValue(parsed.apiKey)).toBe(true);
    expect(parsed.email).toBe("a@b.c");
    expect(parsed.testStatus).toBe("active");

    // The stored bytes are what a backup copies, so this is also the backup property.
    expect(row.data).not.toContain("sk-upstream-plain");
  });

  it("is idempotent when the whole registered chain runs twice", () => {
    const adapter = adapterFor(db);
    db.prepare(
      "INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, 'openai', 'apikey', 'Acct', NULL, 1, 1, ?, ?, ?)",
    ).run("conn-1", JSON.stringify({ apiKey: "sk-once" }), "2026-01-01", "2026-01-01");

    // Mirrors the real runner: each migration gets its OWN transaction
    // (migrate.ts wraps them one at a time), so one failing step cannot roll
    // back the others and a migration that opens its own transaction does not
    // nest.
    for (const pass of [1, 2]) {
      for (const m of MIGRATIONS) {
        expect(
          () => adapter.transaction(() => m.up(adapter)),
          `pass ${pass} migration ${m.version}`,
        ).not.toThrow();
      }
    }

    const row = db.prepare("SELECT data FROM providerConnections").get() as { data: string };
    const parsed = JSON.parse(row.data);
    expect(isEncryptedValue(parsed.apiKey)).toBe(true);
    // Double-encryption would leave a v1: payload wrapping another v1: payload.
    expect(parsed.apiKey.slice(3)).not.toContain("v1:");
  });
});

import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, types, type PoolClient } from "@neondatabase/serverless";
import { TABLES } from "../schema";

/**
 * The only database adapter. Talks to Neon Postgres over the serverless driver.
 *
 * It keeps the shape the repos already speak — `?` placeholders, unquoted
 * camelCase identifiers, `{ changes }` from a write — so migrating 25 repos off
 * SQLite meant adding `await`, not rewriting ~690 queries. The two translations
 * that make that possible are `toPositionalParams` and `remapRow` below.
 */

/**
 * `COUNT(*)` and `SUM(<int>)` come back as int8, which node-postgres hands over
 * as a *string* to avoid losing precision past 2^53. Every consumer here does
 * arithmetic on the result, so a string silently turns `+` into concatenation.
 *
 * ponytail: parsed as Number. These are request counts and token totals — an
 * install that overflows 2^53 of either has bigger problems than this cast.
 */
types.setTypeParser(20, (v: string): number => Number(v));

/**
 * Postgres folds an unquoted `machineId` to `machineid`, consistently in DDL
 * and in queries — so `WHERE machineId = ?` needs no change. What does change
 * is the column name on the way *out*, and the row readers all index by
 * camelCase. This dictionary puts the case back, built from the schema the app
 * already declares rather than a second hand-maintained list.
 */
function buildColumnCasing(): Map<string, string> {
  const casing: Map<string, string> = new Map();
  const add = (name: string): void => {
    const lower: string = name.toLowerCase();
    if (lower === name) return;
    const existing: string | undefined = casing.get(lower);
    if (existing && existing !== name) {
      // Two tables spelling one lowercase name differently would make the
      // remap depend on which table a row came from — which this map cannot
      // know. Fail at import rather than hand back a wrong key at runtime.
      throw new Error(
        `[DB] column casing conflict: "${existing}" and "${name}" both fold to "${lower}"`,
      );
    }
    casing.set(lower, name);
  };
  for (const def of Object.values(TABLES)) for (const col of Object.keys(def.columns)) add(col);
  // The one camelCase alias in the codebase that is not a column
  // (`SELECT MAX(seq) + 1 AS nextSeq` in harnessEvents).
  add("nextSeq");
  return casing;
}

const COLUMN_CASING: Map<string, string> = buildColumnCasing();

export function remapRow(row: Record<string, unknown>): Record<string, unknown> {
  let out: Record<string, unknown> | null = null;
  for (const key of Object.keys(row)) {
    const camel: string | undefined = COLUMN_CASING.get(key);
    if (!camel) continue;
    if (!out) out = { ...row };
    out[camel] = row[key];
    delete out[key];
  }
  return out ?? row;
}

/**
 * Rewrites SQLite's `?` placeholders as Postgres `$1, $2, ...`.
 *
 * Skips anything inside a string literal or a quoted identifier, and inside a
 * `--` comment, so a literal question mark in text is left alone.
 */
export function toPositionalParams(sql: string): string {
  let out: string = "";
  let n: number = 0;
  let i: number = 0;
  while (i < sql.length) {
    const c: string = sql[i];
    if (c === "'" || c === '"') {
      out += c;
      i++;
      while (i < sql.length) {
        if (sql[i] === c) {
          // A doubled quote escapes itself; the literal continues.
          if (sql[i + 1] === c) { out += c + c; i += 2; continue; }
          out += c;
          i++;
          break;
        }
        out += sql[i];
        i++;
      }
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") { out += sql[i]; i++; }
      continue;
    }
    if (c === "?") { n++; out += `$${n}`; i++; continue; }
    out += c;
    i++;
  }
  return out;
}

/**
 * The client a `transaction()` is currently running on.
 *
 * A transaction has to issue BEGIN, its statements and COMMIT on one physical
 * connection, but the repos inside it call `db.get`/`db.run` with no handle to
 * pass. Rather than give every repo a second "transactional" API, the active
 * client rides an AsyncLocalStorage and the query helpers prefer it.
 */
const txClient: AsyncLocalStorage<PoolClient> = new AsyncLocalStorage<PoolClient>();

export interface PostgresAdapter {
  driver: string;
  get(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined>;
  all(sql: string, params?: unknown[]): Promise<Array<Record<string, unknown>>>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
  raw: Pool;
}

export function createPostgresAdapter(connectionString: string): PostgresAdapter {
  const pool: Pool = new Pool({ connectionString });

  async function query(
    sql: string,
    params: unknown[] | undefined,
  ): Promise<Array<Record<string, unknown>>> {
    const text: string = toPositionalParams(sql);
    const client: PoolClient | undefined = txClient.getStore();
    const result = client
      ? await client.query(text, params as unknown[])
      : await pool.query(text, params as unknown[]);
    return (result.rows as Array<Record<string, unknown>>).map(remapRow);
  }

  return {
    driver: "neon-postgres",

    async get(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined> {
      const rows = await query(sql, params);
      return rows[0];
    },

    async all(sql: string, params?: unknown[]): Promise<Array<Record<string, unknown>>> {
      return query(sql, params);
    },

    async run(sql: string, params?: unknown[]): Promise<{ changes: number }> {
      const text: string = toPositionalParams(sql);
      const client: PoolClient | undefined = txClient.getStore();
      const result = client
        ? await client.query(text, params as unknown[])
        : await pool.query(text, params as unknown[]);
      return { changes: result.rowCount ?? 0 };
    },

    /** Multi-statement DDL. Runs on the simple protocol, so no parameters. */
    async exec(sql: string): Promise<void> {
      const client: PoolClient | undefined = txClient.getStore();
      if (client) await client.query(sql);
      else await pool.query(sql);
    },

    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      // Already inside one: join it. Postgres has no nested BEGIN, and the
      // callers that nest expect the outer rollback to cover them.
      if (txClient.getStore()) return fn();

      const client: PoolClient = await pool.connect();
      try {
        await client.query("BEGIN");
        const result: T = await txClient.run(client, fn);
        await client.query("COMMIT");
        return result;
      } catch (err: unknown) {
        try { await client.query("ROLLBACK"); } catch { /* connection already gone */ }
        throw err;
      } finally {
        client.release();
      }
    },

    async close(): Promise<void> {
      await pool.end();
    },

    raw: pool,
  };
}

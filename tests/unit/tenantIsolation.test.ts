import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { TENANT_TABLES } from "@/lib/db/schema";

/**
 * Every row in every table but `_meta` belongs to one account, and nothing in
 * the database enforces it — there is no RLS policy, only a `userId` column
 * and the discipline of putting it in every statement.
 *
 * A missed filter is invisible: the query still runs, still returns rows, and
 * the rows belong to someone else. No type error, no failing assertion in any
 * behavioural test, because the fake adapters those tests use do not implement
 * tenancy. So the guarantee is asserted here, against the source itself.
 *
 * This is a lint, not a proof. It reads that `userId` is named in the
 * statement, not that it is bound to the right value — a query that filters on
 * a hardcoded id would pass. It catches the failure that actually happens: a
 * new repo function written without thinking about the column at all.
 */
const dbRoot = resolve(__dirname, "../../src/lib/db");

/**
 * Statements that must not be tenant-scoped, each with the reason.
 *
 * Every entry here is a place where the tenant is being *established* rather
 * than used, so there is nothing in context to filter on yet.
 */
const UNSCOPED: ReadonlyArray<{ file: string; contains: string; why: string }> = [
  {
    file: "repos/apiKeysRepo.ts",
    contains: "SELECT id, userId, isActive FROM apiKeys WHERE key = ?",
    why: "Resolves which account a gateway request belongs to from its key. The key is globally unique precisely so this lookup needs no tenant.",
  },
];

const TENANT_TABLE_SET: ReadonlySet<string> = new Set(TENANT_TABLES.map((t) => t.toLowerCase()));

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return listSourceFiles(path);
    return entry.endsWith(".ts") ? [path] : [];
  });
}

interface Statement {
  file: string;
  sql: string;
  table: string;
  verb: string;
}

/** Every SQL statement in the persistence layer that names a tenant table. */
function tenantStatements(): Statement[] {
  const found: Statement[] = [];
  // Statements are written as template literals or plain strings, sometimes
  // across several lines with `${...}` holes for IN-lists and dynamic WHERE
  // clauses. Matching from the verb to the closing quote keeps those intact.
  const statement = /(SELECT|INSERT|UPDATE|DELETE)\b[\s\S]*?(?=`|"|'\s*,|'\s*\))/g;

  for (const path of listSourceFiles(dbRoot)) {
    const file = relative(dbRoot, path).replaceAll("\\", "/");
    const source = readFileSync(path, "utf8");
    for (const [sql] of source.matchAll(statement)) {
      const flat = sql.replace(/\s+/g, " ").trim();
      const verb = flat.split(" ")[0]!.toUpperCase();
      const table = tableOf(flat, verb);
      if (!table || !TENANT_TABLE_SET.has(table.toLowerCase())) continue;
      found.push({ file, sql: flat, table, verb });
    }
  }
  return found;
}

function tableOf(sql: string, verb: string): string | null {
  const pattern =
    verb === "INSERT" ? /INSERT INTO\s+([A-Za-z_][A-Za-z0-9_]*)/i
    : verb === "UPDATE" ? /UPDATE\s+([A-Za-z_][A-Za-z0-9_]*)/i
    : /(?:FROM|INTO)\s+([A-Za-z_][A-Za-z0-9_]*)/i;
  return pattern.exec(sql)?.[1] ?? null;
}

function isAllowedUnscoped(entry: Statement): boolean {
  return UNSCOPED.some((a) => entry.file === a.file && entry.sql.includes(a.contains));
}

/**
 * A read or a write names `userId`: in the WHERE clause for reads, updates and
 * deletes, and in the column list for inserts.
 */
function namesTenant(entry: Statement): boolean {
  if (entry.verb === "INSERT") {
    const columns = /INSERT INTO\s+[A-Za-z0-9_]+\s*\(([^)]*)\)/i.exec(entry.sql)?.[1] ?? "";
    return /\buserId\b/i.test(columns);
  }
  const where = entry.sql.replace(/^[\s\S]*?\bWHERE\b/i, "");
  return where !== entry.sql && /\buserId\b/i.test(where);
}

describe("tenant isolation", () => {
  it("finds the statements it is meant to be checking", () => {
    // A regex that silently stops matching would turn this whole file into a
    // test that always passes.
    const statements = tenantStatements();
    expect(statements.length).toBeGreaterThan(60);
    expect(new Set(statements.map((s) => s.table)).size).toBeGreaterThan(15);
  });

  it("scopes every statement against a tenant table to its owner", () => {
    const offenders = tenantStatements()
      .filter((entry) => !namesTenant(entry))
      .filter((entry) => !isAllowedUnscoped(entry))
      .map((entry) => `${entry.file}: ${entry.sql.slice(0, 110)}`);

    expect(offenders).toEqual([]);
  });

  it("keeps every deliberate exception real, so a rewrite cannot hide one", () => {
    const all = tenantStatements();
    for (const allowed of UNSCOPED) {
      const match = all.find((e) => e.file === allowed.file && e.sql.includes(allowed.contains));
      expect(match, `${allowed.file} no longer contains: ${allowed.contains}`).toBeDefined();
    }
  });

  it("covers every table the schema declares as tenant-owned", () => {
    // A table nobody queries yet is fine; a table this scan cannot see is not,
    // because it would be exempt from the check above without anyone saying so.
    const seen = new Set(tenantStatements().map((s) => s.table.toLowerCase()));
    const unreachable = TENANT_TABLES.filter((t) => !seen.has(t.toLowerCase()));
    expect(unreachable).toEqual([]);
  });
});

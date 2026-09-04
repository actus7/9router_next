import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  TEST_STATUS_ON_CREDENTIAL_ACQUIRED,
  normalizeConnectionTestStatus,
  testStatusForValidation,
} from "@/lib/db/repos/connectionsRepo";

const sourceRoot = resolve(__dirname, "../../src");

/**
 * `providerConnections.testStatus` is the result of a connection test, and
 * docs/ARCHITECTURE.md says so. It used to be written by the runtime on token
 * refresh, by twelve OAuth import routes and by the browser, each with its own
 * vocabulary. These three files are the only ones allowed to name a value.
 */
const OWNERS: readonly string[] = [
  "lib/db/repos/connectionsRepo.ts",
  "lib/db/migrations/008-connection-test-status.ts",
  "app/api/providers/[id]/test/testUtils.ts",
];

const STATUS_LITERALS: readonly string[] = [
  '"active"', '"error"', '"unknown"', '"success"', '"expired"', '"unavailable"', '"usage"',
];

// Assignment, not comparison. A property write or an object literal key
// counts; an equality check or an optional-property type does not.
const ASSIGNS_STATUS = /(?:^|[^=!<>])testStatus\s*(?::|=(?!=))/;

// proxyPools carries an unrelated column of the same name.
const UNRELATED_TABLE: readonly string[] = [
  "app/api/proxy-pools",
  "app/(dashboard)/dashboard/proxy-pools",
  "lib/db/repos/proxyPoolsRepo.ts",
];

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return listSourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry) ? [path] : [];
  });
}

function isOwner(path: string): boolean {
  const rel = relative(sourceRoot, path).replaceAll("\\", "/");
  return OWNERS.includes(rel);
}

describe("connection test status ownership", () => {
  it("lets only the owning modules name a status value", () => {
    const offenders = listSourceFiles(sourceRoot)
      .filter((path) => !isOwner(path))
      .filter((path) => {
        const rel = relative(sourceRoot, path).replaceAll("\\", "/");
        return !UNRELATED_TABLE.some((prefix) => rel.startsWith(prefix));
      })
      .flatMap((path) => {
        const lines = readFileSync(path, "utf8").split(/\r?\n/);
        return lines
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => ASSIGNS_STATUS.test(line) && STATUS_LITERALS.some((lit) => line.includes(lit)))
          .map(({ index }) => `${relative(sourceRoot, path).replaceAll("\\", "/")}:${index + 1}`);
      });

    expect(offenders).toEqual([]);
  });

  it("keeps every owner present, so a rename cannot silently disarm the gate", () => {
    const files = new Set(
      listSourceFiles(sourceRoot).map((path) => relative(sourceRoot, path).replaceAll("\\", "/")),
    );
    for (const owner of OWNERS) {
      expect(files.has(owner), `${owner} is allowlisted but missing`).toBe(true);
    }
  });
});

describe("status vocabulary", () => {
  it("maps every legacy value into the closed set", () => {
    expect(normalizeConnectionTestStatus("success")).toBe("active");
    expect(normalizeConnectionTestStatus("active")).toBe("active");
    expect(normalizeConnectionTestStatus("expired")).toBe("error");
    expect(normalizeConnectionTestStatus("unavailable")).toBe("error");
    expect(normalizeConnectionTestStatus("error")).toBe("error");
  });

  it("treats an absent or unrecognized value as not tested", () => {
    expect(normalizeConnectionTestStatus(undefined)).toBe("unknown");
    expect(normalizeConnectionTestStatus(null)).toBe("unknown");
    expect(normalizeConnectionTestStatus("usage")).toBe("unknown");
    expect(normalizeConnectionTestStatus(42)).toBe("unknown");
  });

  it("records a passing form validation and nothing for a failing one", () => {
    expect(testStatusForValidation(true)).toBe("active");
    expect(testStatusForValidation(false)).toBe(TEST_STATUS_ON_CREDENTIAL_ACQUIRED);
    // Acquiring a credential proves the auth endpoint accepted it, not that the
    // provider will serve this account, so it is not a test result.
    expect(TEST_STATUS_ON_CREDENTIAL_ACQUIRED).toBe("unknown");
  });
});

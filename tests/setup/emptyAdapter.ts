import { vi } from "vitest";

/**
 * A database that answers nothing, for tests that are not about the database.
 *
 * There used to be no need for it: the driver fell back to an in-process
 * SQLite file, so a route test that happened to touch a repo quietly got a
 * real empty database. Postgres has no such fallback — `getAdapter()` now
 * throws without `DATABASE_URL`, which is right for production and useless
 * here. Mock `@/lib/db/driver` with this in any test that reaches a repo it
 * does not assert on.
 */
export function emptyAdapter() {
  return {
    driver: "test-empty",
    get: vi.fn(async () => undefined),
    all: vi.fn(async () => []),
    run: vi.fn(async () => ({ changes: 0 })),
    exec: vi.fn(async () => undefined),
    transaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    close: vi.fn(async () => undefined),
    raw: null,
  };
}

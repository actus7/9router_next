import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() =>
  vi.fn((_sql: string, _params?: unknown[]) => ({ changes: 1 })),
);
const get = vi.hoisted(() =>
  vi.fn((_sql: string, _params?: unknown[]) => ({ provider: "claude" }) as { provider: string } | undefined),
);
const all = vi.hoisted(() =>
  vi.fn((_sql: string, _params?: unknown[]) => [] as Record<string, unknown>[]),
);
const transaction = vi.hoisted(() => vi.fn((fn: () => void) => fn()));

vi.mock("@/lib/db/driver", () => ({
  getAdapter: vi.fn(async () => ({ run, get, all, transaction })),
}));

import { deleteProviderConnection } from "@/lib/db/repos/connectionsRepo";

/**
 * There is no FOREIGN KEY anywhere in the schema, so nothing in the database
 * removes a connection's child rows. `modelAvailability` is keyed on
 * connectionId, and the periodic sweep only deletes rows whose `until` has
 * passed — a row with `until IS NULL` outlives its connection forever.
 *
 * The cleanup belongs in the repo rather than in a caller: there are two
 * callers (the DELETE route and the server action), and a guard in one of them
 * leaves the other broken.
 */
describe("deleteProviderConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockReturnValue({ provider: "claude" });
  });

  it("removes the connection's model-availability rows in the same transaction", async () => {
    await deleteProviderConnection("conn-1");

    const availabilityDelete = run.mock.calls.find(([sql]) =>
      String(sql).includes("DELETE FROM modelAvailability"),
    );
    expect(availabilityDelete).toBeDefined();
    expect(availabilityDelete![1]).toEqual(["conn-1"]);
    // One transaction wrapping the whole delete, so a failure cannot leave the
    // connection gone and its availability rows behind.
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("touches nothing when the connection does not exist", async () => {
    get.mockReturnValue(undefined);

    expect(await deleteProviderConnection("missing")).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});

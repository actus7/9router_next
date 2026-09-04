import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() =>
  vi.fn((_sql: string, _params?: unknown[]) => ({ changes: 1 })),
);
const get = vi.hoisted(() =>
  vi.fn((_sql: string, _params?: unknown[]) => undefined as Record<string, unknown> | undefined),
);
const all = vi.hoisted(() =>
  vi.fn((_sql: string, _params?: unknown[]) => [] as Record<string, unknown>[]),
);
const transaction = vi.hoisted(() => vi.fn((fn: () => void) => fn()));

vi.mock("@/lib/db/driver", () => ({
  getAdapter: vi.fn(async () => ({ run, get, all, transaction })),
}));

import {
  getApiKeys,
  issueApiKeyForSink,
  revokeApiKeysForSink,
  validateApiKey,
} from "@/lib/db/repos/apiKeysRepo";

/**
 * One key per destination is what makes the inventory answerable and rotation
 * per-destination. The same key used to be written to every CLI config file,
 * pushed as a cloud env var and handed to the user, with no record of which —
 * so revoking it broke everything at once and nothing said what to reconfigure.
 */
beforeEach(() => {
  vi.clearAllMocks();
  get.mockReturnValue(undefined);
  all.mockReturnValue([]);
});

describe("api key sinks", () => {
  it("mints a key tagged with its destination", async () => {
    const key = await issueApiKeyForSink("Cloud deploy", "machine-1", "cloud:render", "svc-abc");

    expect(key.sink).toBe("cloud:render");
    expect(key.sinkRef).toBe("svc-abc");

    const insert = run.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO apiKeys"));
    expect(insert).toBeDefined();
    expect(insert![1]).toContain("cloud:render");
    expect(insert![1]).toContain("svc-abc");
  });

  it("reuses the live key for a destination instead of minting another", async () => {
    get.mockReturnValue({
      id: "k1",
      key: "sk-machine-1-aaaaaa-deadbeef",
      name: "Cloud deploy",
      machineId: "machine-1",
      isActive: 1,
      createdAt: "2026-09-04T00:00:00.000Z",
      sink: "cloud:render",
      sinkRef: "svc-abc",
      revokedAt: null,
    });

    const key = await issueApiKeyForSink("Cloud deploy", "machine-1", "cloud:render", "svc-abc");

    expect(key.id).toBe("k1");
    expect(run.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO apiKeys"))).toEqual([]);
  });

  it("revokes only the named destination, and leaves the row for history", async () => {
    await revokeApiKeysForSink("cloud:render");

    const update = run.mock.calls.find(([sql]) => String(sql).includes("UPDATE apiKeys"));
    expect(update).toBeDefined();
    const sql = String(update![0]);
    // isActive is the gate validateApiKey reads; revokedAt is only the audit
    // stamp. The row is never deleted, so usageHistory can still resolve it.
    expect(sql).toContain("isActive = 0");
    expect(sql).toContain("revokedAt = ?");
    expect(sql).not.toContain("DELETE");
    expect(update![1]).toContain("cloud:render");
  });

  it("reads a key with no sink as manual, so pre-existing rows still work", async () => {
    all.mockReturnValue([
      {
        id: "legacy",
        key: "sk-old",
        name: "Default Key",
        machineId: "machine-1",
        isActive: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        sink: null,
        sinkRef: null,
        revokedAt: null,
      },
    ]);

    const [legacy] = await getApiKeys();
    expect(legacy.sink).toBe("manual");
    expect(legacy.sinkRef).toBeNull();
  });

  it("still validates by exact key against the store, untouched by sinks", async () => {
    get.mockReturnValue({ isActive: 1 });
    expect(await validateApiKey("sk-old")).toBe(true);

    get.mockReturnValue({ isActive: 0 });
    expect(await validateApiKey("sk-revoked")).toBe(false);

    get.mockReturnValue(undefined);
    expect(await validateApiKey("sk-forged")).toBe(false);
  });
});

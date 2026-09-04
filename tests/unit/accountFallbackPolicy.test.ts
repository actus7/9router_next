import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * noAuth cooldowns are stored in `modelAvailability` under a synthetic
 * connection id, the same table credentialed accounts use. They used to live in
 * a module-level Map, which meant they vanished on every restart and appeared
 * in no UI — and since the free default provider is a noAuth provider, the
 * last-resort routing path had the weakest cooldown of the two.
 *
 * This fake stands in for the table and, crucially, OUTLIVES a module reset, so
 * the restart-survival test below is meaningful rather than tautological.
 */
const availabilityStore = vi.hoisted(() => new Map<string, { until: string | null }>());

vi.mock("@/lib/db/repos/modelAvailabilityRepo", () => ({
  getActiveModelAvailability: vi.fn(async (connectionIds?: string[]) => {
    const now = Date.now();
    return (connectionIds ?? [])
      .map((id) => ({ id, row: availabilityStore.get(id) }))
      .filter((entry) => entry.row && (!entry.row.until || Date.parse(entry.row.until) > now))
      .map((entry) => ({ connectionId: entry.id, modelId: "__all", until: entry.row!.until }));
  }),
  setModelAvailability: vi.fn(async (input: { connectionId: string; until: string | null }) => {
    availabilityStore.set(input.connectionId, { until: input.until });
  }),
}));

import {
  checkFallbackError,
  isClientRequestError,
} from "@/server/llm-gateway/engine/services/accountFallback";
import { __test__ } from "@/server/llm-gateway/auth/accountSelection";
import {
  checkNoAuthCooldownResponse,
  handleNoAuthCooldownResult,
  isNoAuthOnCooldown,
  setNoAuthCooldown,
} from "@/server/llm-gateway/application/noAuthCooldown";

// A credentialed provider that exists in the registry and is not noAuth.
const CREDENTIALED_PROVIDER = "claude";
// A registry provider flagged noAuth (free, no credentials).
const NOAUTH_PROVIDER = "duckai";

const { acquireSelectionLock } = __test__;

beforeEach(() => {
  availabilityStore.clear();
});

describe("isClientRequestError", () => {
  it("classifies malformed-request statuses as the client's fault", () => {
    expect(isClientRequestError(400)).toBe(true);
    expect(isClientRequestError(413)).toBe(true);
    expect(isClientRequestError(422)).toBe(true);
  });

  it("does not classify credential, quota or upstream failures as client errors", () => {
    for (const status of [401, 402, 403, 404, 429, 500, 502, 503]) {
      expect(isClientRequestError(status)).toBe(false);
    }
  });
});

describe("checkFallbackError", () => {
  it("still rotates accounts on rate limit with exponential backoff", () => {
    const result = checkFallbackError(429, "Too Many Requests", 0);
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
  });

  it("still rotates accounts on an unmapped upstream failure", () => {
    expect(checkFallbackError(502, "Bad Gateway", 0).shouldFallback).toBe(true);
  });
});

describe("account selection lock", () => {
  it("serializes picks for one provider and lets a second provider run in parallel", async () => {
    const order: string[] = [];

    const releaseA = await acquireSelectionLock("claude");
    const waiterA = acquireSelectionLock("claude").then((release) => {
      order.push("claude-2");
      release();
    });
    const waiterB = acquireSelectionLock("openrouter").then((release) => {
      order.push("openrouter-1");
      release();
    });

    // The other provider must not be stuck behind the held claude lock.
    await waiterB;
    expect(order).toEqual(["openrouter-1"]);

    releaseA();
    await waiterA;
    expect(order).toEqual(["openrouter-1", "claude-2"]);
  });
});

describe("noAuth cooldown scope", () => {
  it("does not put a credentialed provider on a process-wide cooldown", async () => {
    const response = await handleNoAuthCooldownResult(
      { status: 429, error: "Too Many Requests" },
      CREDENTIALED_PROVIDER,
      "claude-sonnet-4.5",
    );

    // A 429 on one account must fall through to account rotation instead of
    // ending the request and freezing every other account of the provider.
    expect(response).toBeNull();
    expect(await isNoAuthOnCooldown(CREDENTIALED_PROVIDER)).toBe(0);
    expect(await checkNoAuthCooldownResponse(CREDENTIALED_PROVIDER, "claude-sonnet-4.5")).toBeNull();
  });

  it("keeps the cooldown for noAuth providers", async () => {
    const response = await handleNoAuthCooldownResult(
      { status: 429, error: "Too Many Requests" },
      NOAUTH_PROVIDER,
      "gpt-4o-mini",
    );

    expect(response?.status).toBe(429);
    expect(await isNoAuthOnCooldown(NOAUTH_PROVIDER)).toBeGreaterThan(0);
    expect((await checkNoAuthCooldownResponse(NOAUTH_PROVIDER, "gpt-4o-mini"))?.status).toBe(429);
  });

  it("ignores a stale cooldown recorded for a credentialed provider", async () => {
    await setNoAuthCooldown(CREDENTIALED_PROVIDER, 60_000);
    expect(await checkNoAuthCooldownResponse(CREDENTIALED_PROVIDER, "claude-sonnet-4.5")).toBeNull();
  });

  it("survives a restart, because the cooldown is in the store and not in module state", async () => {
    await setNoAuthCooldown(NOAUTH_PROVIDER, 60_000, 429, "Too Many Requests");

    // Drop and re-import the module: a Map held at module scope would come back
    // empty here, which is exactly how the old implementation lost every
    // cooldown on restart.
    vi.resetModules();
    const reloaded = await import("@/server/llm-gateway/application/noAuthCooldown");

    expect(await reloaded.isNoAuthOnCooldown(NOAUTH_PROVIDER)).toBeGreaterThan(0);
    expect((await reloaded.checkNoAuthCooldownResponse(NOAUTH_PROVIDER, "gpt-4o-mini"))?.status).toBe(429);
  });

  it("expires on its own once `until` has passed", async () => {
    await setNoAuthCooldown(NOAUTH_PROVIDER, -1);
    expect(await isNoAuthOnCooldown(NOAUTH_PROVIDER)).toBe(0);
    expect(await checkNoAuthCooldownResponse(NOAUTH_PROVIDER, "gpt-4o-mini")).toBeNull();
  });
});

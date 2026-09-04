import { beforeEach, describe, expect, it } from "vitest";

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
  // Cooldowns live in a module-level Map; expire both providers between tests.
  setNoAuthCooldown(CREDENTIALED_PROVIDER, -1);
  setNoAuthCooldown(NOAUTH_PROVIDER, -1);
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
  it("does not put a credentialed provider on a process-wide cooldown", () => {
    const response = handleNoAuthCooldownResult(
      { status: 429, error: "Too Many Requests" },
      CREDENTIALED_PROVIDER,
      "claude-sonnet-4.5",
    );

    // A 429 on one account must fall through to account rotation instead of
    // ending the request and freezing every other account of the provider.
    expect(response).toBeNull();
    expect(isNoAuthOnCooldown(CREDENTIALED_PROVIDER)).toBe(0);
    expect(checkNoAuthCooldownResponse(CREDENTIALED_PROVIDER, "claude-sonnet-4.5")).toBeNull();
  });

  it("keeps the cooldown for noAuth providers", () => {
    const response = handleNoAuthCooldownResult(
      { status: 429, error: "Too Many Requests" },
      NOAUTH_PROVIDER,
      "gpt-4o-mini",
    );

    expect(response?.status).toBe(429);
    expect(isNoAuthOnCooldown(NOAUTH_PROVIDER)).toBeGreaterThan(0);
    expect(checkNoAuthCooldownResponse(NOAUTH_PROVIDER, "gpt-4o-mini")?.status).toBe(429);
  });

  it("ignores a stale cooldown recorded for a credentialed provider", () => {
    setNoAuthCooldown(CREDENTIALED_PROVIDER, 60_000);
    expect(checkNoAuthCooldownResponse(CREDENTIALED_PROVIDER, "claude-sonnet-4.5")).toBeNull();
  });
});

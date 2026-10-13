import { describe, expect, it } from "vitest";

/**
 * API-key access policies against the running gateway and the real database.
 *
 * Skipped by default — it needs `DATABASE_URL` and a gateway up — and exists
 * because every other access test stubs at least one edge: the 403 here is
 * written by `gatewayRoute` + `assertModelAllowed` on the real request path.
 * Creates a throwaway key, restricts it, calls the gateway, deletes the key.
 *
 *   NODE_OPTIONS="-r dotenv/config" DOTENV_CONFIG_PATH=.env \
 *     LIVE_ACCESS=1 LIVE_ACCESS_TENANT=<tenant uuid> \
 *     npx vitest run tests/unit/accessPolicyLive.test.ts
 *
 * LIVE_ACCESS_BASE (default http://localhost:3000), LIVE_ACCESS_ALLOWED and
 * LIVE_ACCESS_DENIED pick the gateway and the two models.
 */
const LIVE = process.env.LIVE_ACCESS === "1";
const BASE = process.env.LIVE_ACCESS_BASE ?? "http://localhost:3000";
const TENANT = process.env.LIVE_ACCESS_TENANT ?? "";
const ALLOWED = process.env.LIVE_ACCESS_ALLOWED ?? "kgw/kilo-auto/free";
const DENIED = process.env.LIVE_ACCESS_DENIED ?? "kr/claude-sonnet-4.5";

async function call(key: string, path: string, body?: unknown) {
  const response = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, text: await response.text() };
}

describe.skipIf(!LIVE)("API key access policy, live", () => {
  it("refuses a model outside the key's policy and lists only what it may call", async () => {
    expect(TENANT, "LIVE_ACCESS_TENANT is required").not.toBe("");
    const { withTenant } = await import("@/lib/db/tenant");
    const { createApiKey, deleteApiKey } = await import("@/lib/db/repos/apiKeysRepo");
    const { setAccessPolicy } = await import("@/lib/db/repos/accessPoliciesRepo");

    await withTenant(TENANT, async () => {
      const key = await createApiKey("live-access-check", "live-check");
      try {
        await setAccessPolicy("key", key.id, { models: [ALLOWED] });

        const denied = await call(key.key, "/api/v1/chat/completions", {
          model: DENIED,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 5,
        });
        expect(denied.status).toBe(403);
        expect(JSON.parse(denied.text).error.code).toBe("model_not_allowed");

        const models = await call(key.key, "/api/v1/models");
        const ids = (JSON.parse(models.text).data as Array<{ id: string }>).map((entry) => entry.id);
        expect(ids).toEqual([ALLOWED]);

        // The upstream may be rate-limited; what matters is that the policy let it through.
        const allowed = await call(key.key, "/api/v1/chat/completions", {
          model: ALLOWED,
          messages: [{ role: "user", content: "Reply with ok." }],
          max_tokens: 20,
        });
        expect(allowed.status).not.toBe(403);
      } finally {
        await deleteApiKey(key.id);
      }
    });
  }, 120_000);
});

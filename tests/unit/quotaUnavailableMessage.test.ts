import { describe, expect, it, vi } from "vitest";

/**
 * A provider that answers "no quota for you, and here is why" used to come back
 * as an empty quota list, which the Limits card renders as a blank box. The
 * reason is what the operator needs to act on, so it becomes the message.
 */
vi.mock("@/server/llm-gateway/engine/services/usage/shared", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchWithTimeout: vi.fn(async (url: string) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.includes("loadCodeAssist")) {
      // Seen live: no currentTier, the free tier listed as ineligible.
      return json({
        allowedTiers: [{ id: "standard-tier", name: "Antigravity" }],
        ineligibleTiers: [{
          reasonCode: "VALIDATION_REQUIRED",
          reasonMessage: "Your current account is not eligible for Antigravity. Verify your account to continue.\n\nAlternatively, try signing in with another personal Google account.",
          tierId: "free-tier",
        }],
      });
    }
    return json({ models: {} });
  }),
}));
vi.mock("@/server/llm-gateway/engine/utils/proxyFetch", () => ({
  // Seen live on a pay-as-you-go Z.ai key: HTTP 200 with success:false.
  proxyAwareFetch: vi.fn(async () => new Response(JSON.stringify({ code: 500, msg: "当前用户不存在coding plan", success: false }), { status: 200 })),
}));

import { getAntigravityUsage } from "@/server/llm-gateway/engine/services/usage/google";
import { getGlmUsage } from "@/server/llm-gateway/engine/services/usage/misc";

describe("quota APIs that refuse with a reason", () => {
  it("says why an Antigravity account is not eligible", async () => {
    const usage = await getAntigravityUsage("token", {}) as { message?: string };
    expect(usage.message).toContain("not eligible for Antigravity");
    expect(usage.message).not.toContain("Alternatively");
  });

  it("says a GLM key has no Coding Plan", async () => {
    const usage = await getGlmUsage("key", "glm") as { message?: string };
    expect(usage.message).toMatch(/Coding Plan/);
  });
});

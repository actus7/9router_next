import { describe, expect, it } from "vitest";

import { withTenant } from "@/lib/db/tenant";
import { getModelInfo } from "@/server/llm-gateway/application/modelResolution";
import { handleChat } from "@/server/llm-gateway/chat";
import { initTranslators } from "@/server/llm-gateway/translator";

/**
 * The Kilo Gateway report, proven against the real account and the real provider.
 *
 * Kilo's catalogue is vendor-scoped — `openrouter/free`,
 * `inclusionai/ling-3.0-flash-fin:free` — and the chat used to send those ids
 * without the provider prefix. The gateway read the first segment as the
 * provider and answered "No active credentials for provider: openrouter" for a
 * connection that was active and had just passed its test.
 *
 * Nothing here is mocked: it resolves against the account's real connection and
 * calls Kilo. Off by default, like the other live tests — it spends quota and
 * needs `DATABASE_URL`.
 *
 *   LIVE_KILO=1 LIVE_KILO_USER=<uuid> npx vitest run tests/unit/kiloGatewayLive.test.ts
 */
const live = process.env.LIVE_KILO === "1" && !!process.env.LIVE_KILO_USER;
const owner = String(process.env.LIVE_KILO_USER || "");

// The three shapes that matter: a vendor segment that names another provider we
// have no connection for, one that names nothing at all, and Kilo's own.
const MODELS = [
  "kgw/openrouter/free",
  "kgw/inclusionai/ling-3.0-flash-fin:free",
  "kgw/kilo-auto/free",
];

describe.skipIf(!live)("Kilo Gateway against the real account", () => {
  it("routes a vendor-scoped id to Kilo, not to the vendor", async () => {
    for (const model of MODELS) {
      const info = await withTenant(owner, () => getModelInfo(model));
      expect(info.provider, model).toBe("kilo-gateway");
      expect(info.model, model).toBe(model.slice("kgw/".length));
    }
  });

  it("answers a chat on a model whose id starts with another provider's name", async () => {
    initTranslators();

    const response = await withTenant(owner, () =>
      handleChat(new Request("http://localhost/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "kgw/openrouter/free",
          messages: [{ role: "user", content: "Responda apenas: ok" }],
          max_tokens: 16,
          stream: false,
        }),
      })),
    );

    const body = await response.json();
    expect(JSON.stringify(body)).not.toMatch(/No active credentials|No credentials for provider/i);
    expect(response.status, JSON.stringify(body).slice(0, 300)).toBe(200);
    expect(body?.choices?.[0]?.message?.content).toBeTruthy();
  }, 120_000);
});

import { describe, expect, it } from "vitest";

import { withTenant } from "@/lib/db/tenant";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo";
import { listConnectionModels } from "@/server/application/use-cases/http/providers/[id]/models/listConnectionModels";
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
 * `LIVE_KILO_KEY` is a gateway API key *of the same account*: `handleChat`
 * authenticates the caller like any other request, and without one the chat
 * case can only prove a 401. The resolution cases need no key.
 *
 *   LIVE_KILO=1 LIVE_KILO_USER=<uuid> LIVE_KILO_KEY=<sk-...>  *     npx vitest run tests/unit/kiloGatewayLive.test.ts
 */
const live = process.env.LIVE_KILO === "1" && !!process.env.LIVE_KILO_USER;
const owner = String(process.env.LIVE_KILO_USER || "");
const gatewayKey = process.env.LIVE_KILO_KEY || "";

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

  it.skipIf(!gatewayKey)("answers a chat on a model whose id starts with another provider's name", async () => {
    initTranslators();

    const response = await withTenant(owner, () =>
      handleChat(new Request("http://localhost/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${gatewayKey}` },
        body: JSON.stringify({
          model: "kgw/openrouter/free",
          messages: [{ role: "user", content: "Responda apenas: ok" }],
          max_tokens: 16,
          stream: false,
        }),
      })),
    );

    const body = await response.json();
    const text = JSON.stringify(body);

    // The bug: the request never reached Kilo, because `openrouter/` was read
    // as the provider. So what is asserted is arrival, not a good answer —
    // Kilo's free models also return 429 and empty completions on their own,
    // and a test that demanded 200 would fail for the provider's reasons
    // rather than ours.
    expect(text).not.toMatch(/No active credentials|No credentials for provider/i);
    expect(response.status === 200 || /kilo-gateway\//.test(text), text.slice(0, 300)).toBe(true);
    if (response.status === 200) expect(body?.choices?.[0]?.message?.content).toBeTruthy();
  }, 120_000);

  /**
   * Kilo lists the whole marketplace — 381 models when this was written, of
   * which 349 are paid. Storing those filled the picker with models that answer
   * `402 Paid Model - Credits Required`; a batch test disabled 357 in one run.
   */
  it("discovers only the models a free-tier account can call", async () => {
    const listed = await withTenant(owner, async () => {
      const [connection] = await getProviderConnections({ provider: "kilo-gateway", isActive: true });
      return listConnectionModels(connection as unknown as Record<string, unknown>);
    });

    const models = (listed.models || []) as Array<Record<string, unknown>>;
    expect(models.length).toBeGreaterThan(0);
    const paid = models.filter((model) => {
      const pricing = model.pricing as Record<string, unknown> | undefined;
      return model.isFree !== true && pricing
        && (Number(pricing.prompt || 0) > 0 || Number(pricing.completion || 0) > 0);
    });
    expect(paid.map((model) => model.id)).toEqual([]);
  }, 120_000);
});

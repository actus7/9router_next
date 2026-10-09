import { describe, expect, it, vi } from "vitest";
import { handleComboChat } from "@/server/llm-gateway/engine/services/combo";
import { getFirstByteBudget } from "@/server/llm-gateway/engine/utils/firstByteGuard";
import { getCapabilitiesForModel } from "@/server/llm-gateway/engine/providers/capabilities";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const fail = () => new Response(JSON.stringify({ error: { message: "x" } }), { status: 503 });
const ok = () => new Response("{}", { status: 200 });

describe("first-byte guard spares reasoning models", () => {
  const candidates = ["openai/o3", "deepseek/deepseek-reasoner", "anthropic/claude-opus-4-1", "openai/gpt-5"];
  const reasoning = candidates.find((m) => (getCapabilitiesForModel(m.split("/")[0], m.split("/")[1]) as Record<string, unknown>).reasoning === true);

  it("leaves a reasoning model unguarded and guards a plain one", async () => {
    expect(reasoning, "no reasoning model among candidates").toBeTruthy();
    const seen: Record<string, number | undefined> = {};
    await handleComboChat({
      body: {},
      models: [reasoning!, "p/plain", "p/last"],
      handleSingleModel: async (b, m) => { seen[m] = getFirstByteBudget(b); return m === "p/last" ? ok() : fail(); },
      log,
      autoSwitch: false,
      comboFirstByteBudgetMs: 5000,
    });
    expect(seen[reasoning!]).toBeUndefined();
    expect(seen["p/plain"]).toBe(5000);
  });
});

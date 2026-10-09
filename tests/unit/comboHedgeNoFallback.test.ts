import { describe, expect, it, vi } from "vitest";

/**
 * A verdict of "do not fall back" (the body is wrong, every account reproduces
 * it) is only a verdict about the model that gave it. In a hedge it must not let
 * the second model end the race while the first, healthy one is still working.
 */
vi.mock("@/server/llm-gateway/engine/services/accountFallback", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/llm-gateway/engine/services/accountFallback")>();
  return {
    ...actual,
    checkFallbackError: (status: number, text: unknown) =>
      status === 400 ? { shouldFallback: false, cooldownMs: 0 } : actual.checkFallbackError(status, text),
  };
});

import { handleComboChat } from "@/server/llm-gateway/engine/services/combo";
import { getAttemptSignal } from "@/server/llm-gateway/engine/utils/firstByteGuard";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function okResponse(label: string): Response {
  return new Response(label, { status: 200 });
}

describe("combo hedge with a non-fallback error", () => {
  it("lets the healthy primary win over a hedged model that refused the request", async () => {
    const signals = new Map<string, AbortSignal | undefined>();
    const handleSingleModel = async (b: Record<string, unknown>, m: string): Promise<Response> => {
      const signal = getAttemptSignal(b);
      signals.set(m, signal);
      if (m === "picky/m") {
        await new Promise((r) => setTimeout(r, 20));
        return new Response(JSON.stringify({ error: { message: "unsupported parameter" } }), { status: 400 });
      }
      await new Promise((r) => setTimeout(r, 150));
      return okResponse("primary answered");
    };

    const res = await handleComboChat({
      body: { stream: true },
      models: ["slow/m", "picky/m"],
      handleSingleModel: (b, m) => handleSingleModel(b, m === "slow/m" ? "slow/m" : m),
      log,
      comboName: "dev",
      autoSwitch: false,
      comboHedgeDelayMs: 30,
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("primary answered");
    expect(signals.get("slow/m")?.aborted).toBe(false);
  });
});

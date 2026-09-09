import { describe, expect, it, vi } from "vitest";

import { browserOnlyProviderForModel, isBrowserOnlyProvider } from "@/shared/llm-catalog";

/**
 * Puter (MiMo) has no `transport` in its registry entry: it runs in the browser
 * through the Puter SDK, and `executors/puter.ts` throws on purpose if a request
 * reaches the server. Testing it server-side could only ever fail, and it did —
 * retries and an HTTP 502 reported as if the provider were down, while the same
 * model answered fine in the chat.
 */
describe("browser-only providers", () => {
  it("recognises an entry with no server transport", () => {
    expect(isBrowserOnlyProvider({ id: "x" } as never)).toBe(true);
    expect(isBrowserOnlyProvider({ id: "x", transport: { baseUrl: "https://e" } } as never)).toBe(false);
    expect(isBrowserOnlyProvider(undefined)).toBe(false);
  });

  it("answers from the provider prefix the dashboard sends", () => {
    expect(browserOnlyProviderForModel("puter/xiaomi/mimo-v2.5")).toBe("puter");
  });

  /**
   * The regression that made the first attempt at this wrong: `xiaomi/mimo-v2.5`
   * belongs to Puter *and* to tokenrouter, which has a real HTTP transport. Under
   * tokenrouter the model is perfectly testable, so the prefix has to decide.
   */
  it("keeps the same model id testable under a provider that can serve it", () => {
    expect(browserOnlyProviderForModel("tokenrouter/xiaomi/mimo-v2.5")).toBeNull();
    expect(browserOnlyProviderForModel("xiaomi/mimo-v2.5")).toBeNull();
  });

  it("leaves ordinary models and unknown input alone", () => {
    expect(browserOnlyProviderForModel("openai/gpt-4o")).toBeNull();
    expect(browserOnlyProviderForModel("modelo-que-nao-existe")).toBeNull();
    expect(browserOnlyProviderForModel("")).toBeNull();
  });
});

describe("pingModelByKind", () => {
  it("says so instead of probing a browser-only model", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { pingModelByKind } = await import("@/app/api/models/test/ping");

    const result = await pingModelByKind("puter/xiaomi/mimo-v2.5", "llm");

    expect(result.ok).toBe(false);
    expect(result.note).toBe("browser-only");
    expect(result.error).toMatch(/chat/i);
    // The point of the fix: no request, so no retries and no misleading 502.
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

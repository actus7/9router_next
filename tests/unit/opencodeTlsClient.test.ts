import { describe, expect, it, vi } from "vitest";

/**
 * wreq's `timeout` bounds the whole request, body included, so a finite value
 * cut long SSE answers mid-stream. The client must disable it and leave the
 * wait to the caller's abort signal.
 */
const sessionFetch = vi.hoisted(() => vi.fn(async () => ({ status: 200, headers: undefined, body: null })));
vi.mock("wreq-js", () => ({ createSession: vi.fn(async () => ({ fetch: sessionFetch })) }));

import { opencodeTlsFetch } from "@/server/llm-gateway/engine/services/opencodeTlsClient";

describe("opencodeTlsFetch", () => {
  it("sends no total timeout and forwards the caller's abort signal", async () => {
    const controller = new AbortController();

    await opencodeTlsFetch("https://opencode.ai/zen/v1/chat/completions", { method: "POST", body: "{}", signal: controller.signal });

    expect(sessionFetch).toHaveBeenCalledWith(
      "https://opencode.ai/zen/v1/chat/completions",
      expect.objectContaining({ timeout: 0, signal: controller.signal, body: "{}" }),
    );
  });
});

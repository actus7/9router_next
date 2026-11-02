import { describe, expect, it, vi } from "vitest";

/**
 * wreq's `timeout` bounds the whole request, body included, so a finite value
 * cut long SSE answers mid-stream. The client must disable it and leave the
 * wait to the caller's abort signal.
 */
const wreqFetch = vi.hoisted(() => vi.fn(async (): Promise<{ status: number; headers: undefined; body: ReadableStream | null }> => ({ status: 200, headers: undefined, body: null })));
const transport = vi.hoisted(() => ({ id: "transport" }));
const createSession = vi.hoisted(() => vi.fn());
vi.mock("wreq-js", () => ({ createTransport: vi.fn(async () => transport), fetch: wreqFetch, createSession }));

import { opencodeTlsFetch } from "@/server/llm-gateway/engine/services/opencodeTlsClient";

describe("opencodeTlsFetch", () => {
  it("sends no total timeout and forwards the caller's abort signal", async () => {
    const controller = new AbortController();

    await opencodeTlsFetch("https://opencode.ai/zen/v1/chat/completions", { method: "POST", body: "{}", signal: controller.signal });

    expect(wreqFetch).toHaveBeenCalledWith(
      "https://opencode.ai/zen/v1/chat/completions",
      expect.objectContaining({ timeout: 0, signal: controller.signal, body: "{}" }),
    );
  });

  it("goes through a cookie-less transport, never a session shared across accounts", async () => {
    await opencodeTlsFetch("https://opencode.ai/zen/v1/models");

    expect(wreqFetch).toHaveBeenLastCalledWith("https://opencode.ai/zen/v1/models", expect.objectContaining({ transport }));
    expect(createSession).not.toHaveBeenCalled();
  });

  it("returns a null-body status instead of throwing when upstream sends a body with it", async () => {
    wreqFetch.mockResolvedValueOnce({ status: 204, headers: undefined, body: new ReadableStream() });

    const res = await opencodeTlsFetch("https://opencode.ai/zen/v1/models");

    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });
});

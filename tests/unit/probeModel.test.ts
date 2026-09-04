import { afterEach, describe, expect, it, vi } from "vitest";

import { probeModel } from "@/app/(dashboard)/dashboard/providers/probeModel";

function respondWith(body: unknown): void {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("probeModel", () => {
  it("reports a reachable model with its latency", async () => {
    respondWith({ ok: true, latencyMs: 412, status: 200 });

    const result = await probeModel("openai/gpt-4o");

    expect(result).toEqual({ status: "ok", error: "", latencyMs: 412, httpStatus: 200 });
  });

  it("carries the upstream status and timeout flag on failure", async () => {
    respondWith({ ok: false, error: "Model is not reachable", status: 504, isTimeout: true });

    const result = await probeModel("openai/gpt-4o");

    expect(result.status).toBe("error");
    expect(result.error).toBe("Model is not reachable");
    expect(result.httpStatus).toBe(504);
    expect(result.isTimeout).toBe(true);
  });

  it("sends kind and timeout only when asked", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{\"ok\":true}", {
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await probeModel("openai/dall-e-3", { kind: "image", timeoutMs: 9000 });
    const sentWithOptions = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(sentWithOptions).toEqual({ model: "openai/dall-e-3", kind: "image", timeoutMs: 9000 });

    await probeModel("openai/gpt-4o");
    const sentBare = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(sentBare).toEqual({ model: "openai/gpt-4o" });
  });

  it("marks an aborted probe as cancelled rather than a model failure", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    }));

    const result = await probeModel("openai/gpt-4o", { signal: controller.signal });

    expect(result.cancelled).toBe(true);
    expect(result.status).toBe("error");
    // No message: the caller renders its own "cancelled" wording.
    expect(result.error).toBe("");
  });

  it("survives a response that is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>gateway down</html>")));

    const result = await probeModel("openai/gpt-4o");

    expect(result.status).toBe("error");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { executeRuntimeToolCall } from "@/app/(dashboard)/dashboard/basic-chat/hooks/executeRuntimeToolCall";
import type { NormalizedModel, ToolCall } from "@/app/(dashboard)/dashboard/basic-chat/types";

const model: NormalizedModel = {
  id: "provider:model", requestModel: "model", name: "Model", providerId: "provider", providerName: "Provider", source: "configured",
};
const context = () => ({ apiKey: "key", model, signal: new AbortController().signal });

afterEach(() => vi.unstubAllGlobals());

describe("executeRuntimeToolCall", () => {
  it("rejects malformed tool arguments without making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const call: ToolCall = { id: "call", name: "web_search", arguments: "not-json" };

    await expect(executeRuntimeToolCall(call, context())).resolves.toContain("not valid JSON");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs web search through the application endpoint", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"data":[{"kind":"webSearch","owned_by":"search-provider"}]}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"results":[]}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const call: ToolCall = { id: "call", name: "web_search", arguments: '{"query":"latest AI news","max_results":99}' };

    await expect(executeRuntimeToolCall(call, context())).resolves.toBe('{"results":[]}');
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/search", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ query: "latest AI news", provider: "search-provider", max_results: 10 }),
    }));
  });
});

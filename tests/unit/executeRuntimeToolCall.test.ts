import { afterEach, describe, expect, it, vi } from "vitest";
import { executeRuntimeToolCall } from "@/app/(dashboard)/dashboard/basic-chat/hooks/executeRuntimeToolCall";
import type { NormalizedModel, ToolCall } from "@/app/(dashboard)/dashboard/basic-chat/types";

const model: NormalizedModel = {
  id: "provider:model", requestModel: "model", name: "Model", providerId: "provider", providerName: "Provider", source: "configured",
};
const context = () => ({ apiKey: "key", model, signal: new AbortController().signal });

function ok(body: string, status = 200) {
  return new Response(body, { status });
}

function httpError(status: number, body = "server error") {
  return new Response(body, { status });
}

afterEach(() => vi.unstubAllGlobals());

describe("executeRuntimeToolCall", () => {
  // ── Argumentos malformados ──────────────────────────────────────────────
  it("rejects malformed tool arguments without making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const call: ToolCall = { id: "call", name: "web_search", arguments: "not-json" };

    await expect(executeRuntimeToolCall(call, context())).resolves.toContain("not valid JSON");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── web_search: comportamento existente ─────────────────────────────────
  it("runs web search through the application endpoint", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok('{"data":[{"kind":"webSearch","owned_by":"search-provider"}]}'))
      .mockResolvedValueOnce(ok('{"results":[]}'));
    vi.stubGlobal("fetch", fetchMock);
    const call: ToolCall = { id: "call", name: "web_search", arguments: '{"query":"latest AI news","max_results":99}' };

    await expect(executeRuntimeToolCall(call, context())).resolves.toBe('{"results":[]}');
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/search", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ query: "latest AI news", provider: "search-provider", max_results: 10 }),
    }));
  });

  // ── Deduplicação por provider ───────────────────────────────────────────
  it("deduplicates candidates by provider, keeping first occurrence", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(JSON.stringify({
        data: [
          { kind: "webSearch", owned_by: "alpha" },
          { kind: "webSearch", owned_by: "beta" },
          { kind: "webSearch", owned_by: "alpha" },
          { kind: "webSearch", owned_by: "beta" },
        ],
      })))
      .mockResolvedValueOnce(ok('{"results":[]}'));
    vi.stubGlobal("fetch", fetchMock);
    const call: ToolCall = { id: "call", name: "web_search", arguments: '{"query":"test"}' };

    const result = await executeRuntimeToolCall(call, context());
    expect(result).toBe('{"results":[]}');
    // Segunda chamada usa "alpha" (primeiro candidato deduplicado)
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/search", expect.objectContaining({
      body: expect.stringContaining('"alpha"'),
    }));
  });

  // ── Primeiro provider falha, segundo funciona ──────────────────────────
  it("falls back to second provider when first returns HTTP error", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(JSON.stringify({
        data: [
          { kind: "webSearch", owned_by: "failing-provider" },
          { kind: "webSearch", owned_by: "good-provider" },
        ],
      })))
      .mockResolvedValueOnce(httpError(500, "internal error"))
      .mockResolvedValueOnce(ok('{"results":[{"title":"found"}]}'));
    vi.stubGlobal("fetch", fetchMock);
    const call: ToolCall = { id: "call", name: "web_search", arguments: '{"query":"fallback test"}' };

    const result = await executeRuntimeToolCall(call, context());
    expect(result).toBe('{"results":[{"title":"found"}]}');
    // Terceira chamada usa "good-provider"
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/v1/search", expect.objectContaining({
      body: expect.stringContaining('"good-provider"'),
    }));
  });

  // ── Todos os providers falham ───────────────────────────────────────────
  it("returns error with attempt details when all providers fail", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(JSON.stringify({
        data: [
          { kind: "webSearch", owned_by: "alpha" },
          { kind: "webSearch", owned_by: "beta" },
        ],
      })))
      .mockResolvedValueOnce(httpError(502, "bad gateway"))
      .mockResolvedValueOnce(httpError(429, "rate limited"));
    vi.stubGlobal("fetch", fetchMock);
    const call: ToolCall = { id: "call", name: "web_search", arguments: '{"query":"all fail"}' };

    const result = JSON.parse(await executeRuntimeToolCall(call, context()));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("All providers failed");
    expect(result.attempts).toEqual([
      { provider: "alpha", status: 502 },
      { provider: "beta", status: 429 },
    ]);
    expect(result.status).toBe(429);
  });

  // ── Nenhum provider configurado ────────────────────────────────────────
  it("returns clear message when no provider is configured", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok('{"data":[]}'));
    vi.stubGlobal("fetch", fetchMock);
    const call: ToolCall = { id: "call", name: "web_search", arguments: '{"query":"no provider"}' };

    const result = JSON.parse(await executeRuntimeToolCall(call, context()));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("No configured web search provider");
  });

  it("returns clear message when models endpoint returns null data", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok('{"data":null}'));
    vi.stubGlobal("fetch", fetchMock);
    const call: ToolCall = { id: "call", name: "web_search", arguments: '{"query":"null data"}' };

    const result = JSON.parse(await executeRuntimeToolCall(call, context()));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("No configured web search provider");
  });

  // ── web_fetch: fallback ─────────────────────────────────────────────────
  it("falls back providers for web_fetch", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(JSON.stringify({
        data: [
          { kind: "webFetch", owned_by: "fetch-a" },
          { kind: "webFetch", owned_by: "fetch-b" },
        ],
      })))
      .mockResolvedValueOnce(httpError(503, "unavailable"))
      .mockResolvedValueOnce(ok("page content here"));
    vi.stubGlobal("fetch", fetchMock);
    const call: ToolCall = { id: "call", name: "web_fetch", arguments: '{"url":"https://example.com"}' };

    const result = await executeRuntimeToolCall(call, context());
    expect(result).toBe("page content here");
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/v1/web/fetch", expect.objectContaining({
      body: expect.stringContaining('"fetch-b"'),
    }));
  });

  it("returns error with attempts when all web_fetch providers fail", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(JSON.stringify({
        data: [
          { kind: "webFetch", owned_by: "fetch-a" },
          { kind: "webFetch", owned_by: "fetch-b" },
        ],
      })))
      .mockResolvedValueOnce(httpError(500))
      .mockResolvedValueOnce(httpError(500));
    vi.stubGlobal("fetch", fetchMock);
    const call: ToolCall = { id: "call", name: "web_fetch", arguments: '{"url":"https://example.com"}' };

    const result = JSON.parse(await executeRuntimeToolCall(call, context()));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("All providers failed");
    expect(result.attempts).toHaveLength(2);
  });

  // ── AbortSignal: cancelamento não vira fallback ────────────────────────
  it("propagates AbortError without triggering fallback", async () => {
    const ac = new AbortController();
    ac.abort(); // Aborta antes de qualquer chamada
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(JSON.stringify({
        data: [
          { kind: "webSearch", owned_by: "alpha" },
          { kind: "webSearch", owned_by: "beta" },
        ],
      })))
      .mockRejectedValue(new DOMException("The operation was aborted.", "AbortError"));
    vi.stubGlobal("fetch", fetchMock);
    const call: ToolCall = { id: "call", name: "web_search", arguments: '{"query":"abort test"}' };

    await expect(executeRuntimeToolCall(call, { ...context(), signal: ac.signal })).rejects.toThrow("aborted");
    // Deve ter chamado models + 1 search (não deve tentar o segundo provider)
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // ── kind: smart não é considerado ───────────────────────────────────────
  it("ignores entries with kind:smart and uses only exact webSearch/webFetch", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(JSON.stringify({
        data: [
          { kind: "smart", owned_by: "smart-provider" },
          { kind: "webSearch", owned_by: "real-search" },
        ],
      })))
      .mockResolvedValueOnce(ok('{"results":[]}'));
    vi.stubGlobal("fetch", fetchMock);
    const call: ToolCall = { id: "call", name: "web_search", arguments: '{"query":"smart filter"}' };

    await executeRuntimeToolCall(call, context());
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/search", expect.objectContaining({
      body: expect.stringContaining('"real-search"'),
    }));
  });

  // ── max_characters clamped para web_fetch ───────────────────────────────
  it("clamps max_characters for web_fetch", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(JSON.stringify({
        data: [{ kind: "webFetch", owned_by: "provider" }],
      })))
      .mockResolvedValueOnce(ok("content"));
    vi.stubGlobal("fetch", fetchMock);
    const call: ToolCall = { id: "call", name: "web_fetch", arguments: '{"url":"https://example.com","max_characters":999999}' };

    await executeRuntimeToolCall(call, context());
    const opts = fetchMock.mock.calls[1]![1] as { body: string };
    const body = JSON.parse(opts.body);
    expect(body.max_characters).toBe(30_000);
  });

  // ── Resposta truncada ───────────────────────────────────────────────────
  it("truncates oversized responses", async () => {
    const bigContent = "x".repeat(40_000);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(JSON.stringify({
        data: [{ kind: "webSearch", owned_by: "provider" }],
      })))
      .mockResolvedValueOnce(ok(bigContent));
    vi.stubGlobal("fetch", fetchMock);
    const call: ToolCall = { id: "call", name: "web_search", arguments: '{"query":"big"}' };

    const result = await executeRuntimeToolCall(call, context());
    expect(result).toContain("[truncated]");
    expect(result.length).toBeLessThan(40_000);
  });

  // ── delegate_task: comportamento existente ──────────────────────────────
  it("delegates task to sub-agent", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(JSON.stringify({
        choices: [{ message: { content: "sub-agent result" } }],
      })));
    vi.stubGlobal("fetch", fetchMock);
    const call: ToolCall = { id: "call", name: "delegate_task", arguments: '{"task":"summarize this"}' };

    const result = JSON.parse(await executeRuntimeToolCall(call, context()));
    expect(result.ok).toBe(true);
    expect(result.result).toBe("sub-agent result");
  });

  // ── web_search: query vazia ─────────────────────────────────────────────
  it("rejects empty query for web_search", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const call: ToolCall = { id: "call", name: "web_search", arguments: '{"query":"  "}' };

    const result = JSON.parse(await executeRuntimeToolCall(call, context()));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("non-empty query");
  });

  // ── web_fetch: url vazia ────────────────────────────────────────────────
  it("rejects empty url for web_fetch", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const call: ToolCall = { id: "call", name: "web_fetch", arguments: '{"url":""}' };

    const result = JSON.parse(await executeRuntimeToolCall(call, context()));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("public URL");
  });

  // ── Ferramenta desconhecida ─────────────────────────────────────────────
  it("rejects unsupported tool names", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const call: ToolCall = { id: "call", name: "unknown_tool", arguments: '{}' };

    const result = JSON.parse(await executeRuntimeToolCall(call, context()));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unsupported runtime tool");
  });

  // ── Fallback usa owned_by, depois id ────────────────────────────────────
  it("uses owned_by first, falls back to id for provider name", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(JSON.stringify({
        data: [
          { kind: "webSearch", id: "some-model/search" },
        ],
      })))
      .mockResolvedValueOnce(ok('{"results":[]}'));
    vi.stubGlobal("fetch", fetchMock);
    const call: ToolCall = { id: "call", name: "web_search", arguments: '{"query":"id fallback"}' };

    await executeRuntimeToolCall(call, context());
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/search", expect.objectContaining({
      body: expect.stringContaining('"some-model"'),
    }));
  });

  it("uses the combo id instead of the generic combo owner", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(JSON.stringify({
        data: [{ kind: "webSearch", owned_by: "combo", id: "research-combo" }],
      })))
      .mockResolvedValueOnce(ok('{"results":[]}'));
    vi.stubGlobal("fetch", fetchMock);
    const call: ToolCall = { id: "call", name: "web_search", arguments: '{"query":"combo routing"}' };

    await executeRuntimeToolCall(call, context());
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/search", expect.objectContaining({
      body: expect.stringContaining('"research-combo"'),
    }));
  });

  it("removes the fetch suffix when owned_by is missing", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(JSON.stringify({
        data: [{ kind: "webFetch", id: "fetch-provider/fetch" }],
      })))
      .mockResolvedValueOnce(ok("content"));
    vi.stubGlobal("fetch", fetchMock);
    const call: ToolCall = { id: "call", name: "web_fetch", arguments: '{"url":"https://example.com"}' };

    await executeRuntimeToolCall(call, context());
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/web/fetch", expect.objectContaining({
      body: expect.stringContaining('"fetch-provider"'),
    }));
  });

  // ── Models endpoint falha ───────────────────────────────────────────────
  it("returns no-provider message when models endpoint fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(httpError(500));
    vi.stubGlobal("fetch", fetchMock);
    const call: ToolCall = { id: "call", name: "web_search", arguments: '{"query":"endpoint down"}' };

    const result = JSON.parse(await executeRuntimeToolCall(call, context()));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("No configured web search provider");
  });
});

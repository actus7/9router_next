import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setAttemptSignal } from "@/server/llm-gateway/engine/utils/firstByteGuard";

// Keep the real core, executor, translators and stream handlers. Only persistence
// is stubbed; the transport below never contacts a provider.
vi.mock("@/server/llm-gateway/engine/host/usage", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => undefined),
  saveRequestDetail: vi.fn(async () => undefined),
  saveRequestUsage: vi.fn(async () => undefined),
}));
vi.mock("@/lib/db/repos/pluginRowsRepo", () => ({
  listPluginRows: vi.fn(async () => []),
  getPluginTreeRevision: vi.fn(async () => 0),
}));

const fetchMock = vi.fn<typeof fetch>();
let handleChatCore: typeof import("@/server/llm-gateway/engine/handlers/chatCore").handleChatCore;

function stubEnvironment() {
  vi.stubEnv("ENABLE_REQUEST_LOGS", "false");
  vi.stubEnv("ALLOW_PRIVATE_PROVIDER_ENDPOINTS", "false");
  for (const name of ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "https_proxy", "http_proxy", "all_proxy"]) {
    vi.stubEnv(name, "");
  }
  vi.stubGlobal("fetch", fetchMock);
}

beforeAll(async () => {
  // proxyFetch captures global fetch at module load, so install the transport
  // before importing the real core (and keep this same mock for every case).
  stubEnvironment();
  ({ handleChatCore } = await import("@/server/llm-gateway/engine/handlers/chatCore"));
}, 60_000);

beforeEach(() => {
  fetchMock.mockReset();
  stubEnvironment();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function requestBody(stream: boolean): Record<string, unknown> {
  return {
    model: "characterization-chat",
    stream,
    messages: [{ role: "user", content: "Return the requested answer." }],
  };
}

function call(body: Record<string, unknown>) {
  return handleChatCore({
    body,
    modelInfo: { provider: "openai-compatible-characterization", model: "characterization-chat" },
    credentials: { apiKey: "test-key", providerSpecificData: { baseUrl: "https://upstream.example.test/v1" } },
    connectionId: "characterization-connection",
    sourceFormatOverride: "openai",
    rtkEnabled: false,
    headroomEnabled: false,
    cavemanEnabled: false,
    ponytailEnabled: false,
    neutralityEnabled: false,
    metaBreakEnabled: false,
    synapseEnabled: false,
    pxpipeEnabled: false,
  });
}

describe("handleChatCore characterization", () => {
  it("returns the two OpenAI SSE deltas in order and one terminal event", async () => {
    const chunks = [
      { id: "test-completion", object: "chat.completion.chunk", model: "characterization-chat", choices: [{ index: 0, delta: { role: "assistant", content: "First " }, finish_reason: null }] },
      { id: "test-completion", object: "chat.completion.chunk", model: "characterization-chat", choices: [{ index: 0, delta: { content: "second" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } },
    ];
    const sse = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
    fetchMock.mockResolvedValue(new Response(sse, { headers: { "Content-Type": "text/event-stream" } }));

    const result = await call(requestBody(true));

    expect(result.response.status).toBe(200);
    const events = (await result.response.text()).split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());
    expect(events.filter((event) => event === "[DONE]")).toHaveLength(1);
    expect(events.at(-1)).toBe("[DONE]");
    const deltas = events.filter((event) => event !== "[DONE]")
      .map((event) => JSON.parse(event) as { choices?: { delta?: { content?: string } }[] })
      .map((event) => event.choices?.[0]?.delta?.content)
      .filter((content) => content !== undefined);
    expect(deltas).toEqual(["First ", "second"]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("https://upstream.example.test/v1/chat/completions");
  });

  it("returns the observed 499 response for an already aborted hedge attempt", async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      const signal = init?.signal;
      if (!signal) throw new Error("The executor must forward an abort signal");
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException("The request was aborted", "AbortError"));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    });
    const body = requestBody(true);
    const attempt = new AbortController();
    attempt.abort();
    setAttemptSignal(body, attempt.signal);

    const result = await call(body);

    expect(result.response.status).toBe(499);
    expect(await result.response.json()).toMatchObject({ error: { message: "Request aborted" } });
  });

  it("propagates an upstream JSON 500 status and error message", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: "Synthetic upstream failure" } }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    }));

    const result = await call(requestBody(false));

    expect(result.response.status).toBe(500);
    const body = await result.response.json() as { error: { message: string } };
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(body.error.message).toContain("Synthetic upstream failure");
  });
});

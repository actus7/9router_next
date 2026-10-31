import { afterEach, describe, expect, it, vi } from "vitest";

import { MEMORY_CONFIG } from "@/server/llm-gateway/engine/config/runtimeConfig";
import {
  OpenCodeExecutor,
  buildOpencodeZenHeaders,
  buildOpencodeZenProbeRequest,
  generateSessionId,
  hasValidOpencodeVersion,
  stableOpencodeSessionId,
} from "@/server/llm-gateway/engine/executors/opencode";
import {
  applyFingerprintTools,
  recordRenamedToolNames,
  takeRenamedToolNames,
} from "@/server/llm-gateway/engine/utils/opencodeFingerprint";
import { handleForcedSSEToJson } from "@/server/llm-gateway/engine/handlers/chatCore/sseToJsonHandler";
import { proxyAwareFetch } from "@/server/llm-gateway/engine/utils/proxyFetch";
import { opencodeTlsFetch } from "@/server/llm-gateway/engine/services/opencodeTlsClient";
import opencodeRegistry from "@/server/llm-gateway/engine/providers/registry/opencode";
import type { Credentials } from "@/server/llm-gateway/engine/services/types";

const SESSION_ID_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
type Rec = Record<string, unknown>;
const nameOf = (tool: Rec) => ((tool.function as Rec | undefined)?.name ?? tool.name) as string;

vi.mock("@/server/llm-gateway/engine/host/usage", () => ({
  saveRequestDetail: vi.fn(async () => null),
  saveRequestUsage: vi.fn(async () => 1),
}));

vi.mock("@/server/llm-gateway/engine/services/opencodeTlsClient", () => ({
  opencodeTlsFetch: vi.fn(async () => new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } })),
}));

afterEach(() => vi.unstubAllGlobals());

describe("generateSessionId", () => {
  it("mints the canonical shape from the current time", () => {
    expect(generateSessionId()).toMatch(SESSION_ID_RE);
    expect(new Set([generateSessionId(), generateSessionId()]).size).toBe(2);
  });
});

describe("hasValidOpencodeVersion", () => {
  it("accepts only the v2 opencode/<channel>/<version>/<client> shape", () => {
    expect(hasValidOpencodeVersion("opencode/latest/2.0.26/cli")).toBe(true);
    expect(hasValidOpencodeVersion("opencode/beta/3.1.0/desktop")).toBe(true);
    // The v1 form is refused upstream with 403 since 2026-10-14.
    expect(hasValidOpencodeVersion("opencode/1.18.31")).toBe(false);
    expect(hasValidOpencodeVersion("opencode/latest/1.9.0/cli")).toBe(false);
    expect(hasValidOpencodeVersion("curl/8.0")).toBe(false);
    expect(hasValidOpencodeVersion(undefined)).toBe(false);
  });
});

describe("stableOpencodeSessionId", () => {
  it("reuses one session per connection and separates connections", () => {
    const a = stableOpencodeSessionId({ connectionId: "conn-stable-a" } as Credentials);
    expect(stableOpencodeSessionId({ connectionId: "conn-stable-a" } as Credentials)).toBe(a);
    expect(stableOpencodeSessionId({ connectionId: "conn-stable-b" } as Credentials)).not.toBe(a);
    expect(a).toMatch(SESSION_ID_RE);
  });

  it("mints a new session once the old one idles past the TTL", () => {
    const credentials = { connectionId: "conn-stable-ttl" } as Credentials;
    const first = stableOpencodeSessionId(credentials);
    const now = Date.now();
    const spy = vi.spyOn(Date, "now").mockReturnValue(now + MEMORY_CONFIG.sessionTtlMs + 1);
    try {
      expect(stableOpencodeSessionId(credentials)).not.toBe(first);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("buildOpencodeZenHeaders", () => {
  it("sends the v2 CLI header set and no x-opencode-request", () => {
    const headers = buildOpencodeZenHeaders({ credentials: { connectionId: "conn-h" } as Credentials });
    expect(headers["User-Agent"]).toBe("opencode/latest/2.0.26/cli");
    expect(headers["x-opencode-client"]).toBe("cli");
    expect(headers.Authorization).toBe("Bearer public");
    expect(headers["x-opencode-project"]).toBe("global");
    for (const key of ["x-opencode-session", "x-opencode-session-id", "x-session-affinity", "x-session-id"]) {
      expect(headers[key]).toBe(headers["x-opencode-session"]);
    }
    expect(headers["x-opencode-session"]).toMatch(SESSION_ID_RE);
    expect(headers["x-opencode-request"]).toBeUndefined();
  });

  it("passes a v2 downstream UA and a canonical downstream session through", () => {
    const session = "ses_0123456789abABCDEFGHIJKLMN";
    const headers = buildOpencodeZenHeaders({ rawHeaders: { "User-Agent": "opencode/latest/2.1.0/desktop", "x-opencode-session": session } });
    expect(headers["User-Agent"]).toBe("opencode/latest/2.1.0/desktop");
    expect(headers["x-opencode-session"]).toBe(session);
  });

  it("replaces a v1 UA and a malformed session", () => {
    const headers = buildOpencodeZenHeaders({ rawHeaders: { "user-agent": "opencode/1.18.31", "x-opencode-session": "ses_bad" } });
    expect(headers["User-Agent"]).toBe("opencode/latest/2.0.26/cli");
    expect(headers["x-opencode-session"]).toMatch(SESSION_ID_RE);
  });

  it("adds anthropic-version only for /messages URLs", () => {
    expect(buildOpencodeZenHeaders({ url: "https://opencode.ai/inference/v1/messages" })["anthropic-version"]).toBe("2023-06-01");
    expect(buildOpencodeZenHeaders({ url: "https://opencode.ai/inference/v1/chat/completions" })["anthropic-version"]).toBeUndefined();
  });
});

describe("buildOpencodeZenProbeRequest", () => {
  it("probes /inference/v1 with both body gates", () => {
    const probe = buildOpencodeZenProbeRequest();
    expect(probe.url).toBe("https://opencode.ai/inference/v1/chat/completions");
    expect((probe.body.tools as Rec[]).map(nameOf)).toEqual(["read", "shell"]);
    expect(JSON.stringify(probe.body.messages)).toContain("<env>");
    expect(probe.headers["User-Agent"]).toBe("opencode/latest/2.0.26/cli");
  });
});

describe("OpenCodeExecutor routing", () => {
  const executor = new OpenCodeExecutor();

  it("sends chat models to /inference/v1/chat/completions and the special ones to their endpoint", () => {
    expect(executor.buildUrl("big-pickle")).toBe("https://opencode.ai/inference/v1/chat/completions");
    expect(executor.buildUrl("muse-spark-1.3-contributor-free")).toBe("https://opencode.ai/inference/v1/responses");
    expect(executor.buildUrl("union-alpha")).toBe("https://opencode.ai/inference/v1/messages");
  });

  it("declares the non-chat models' target format as overrides, since the catalogue is discovered", () => {
    expect(opencodeRegistry.modelOverrides).toEqual({
      "muse-spark-1.2-contributor-free": { targetFormat: "openai-responses" },
      "muse-spark-1.3-contributor-free": { targetFormat: "openai-responses" },
      "union-alpha": { targetFormat: "claude" },
    });
  });
});

describe("OpenCodeExecutor.transformRequest", () => {
  const executor = new OpenCodeExecutor();

  it("fingerprints a copy, forces streaming and keeps the caller's tool list", () => {
    const body: Rec = {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "read", parameters: { type: "object", properties: { file: {} } } } }],
    };
    const out = executor.transformRequest("big-pickle", body, false, { connectionId: "conn-transform" } as Credentials);
    expect(out.stream).toBe(true);
    expect(takeRenamedToolNames(out)?.get("read_client")).toBe("read");
    expect((out.tools as Rec[]).map(nameOf)).toEqual(["read_client", "read", "shell"]);
    expect(JSON.stringify(out.messages)).toContain("<env>");
    expect((body.tools as unknown[]).length).toBe(1);
  });

  it("drops an adaptive reasoning_effort the chat lane would answer 400", () => {
    const out = executor.transformRequest("big-pickle", { messages: [], reasoning_effort: "auto" }, true);
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("shapes Responses bodies for the muse-spark lane", () => {
    const out = executor.transformRequest("muse-spark-1.3-contributor-free", {
      input: "hi",
      max_tokens: 64,
      reasoning_effort: "high",
      tool_choice: "required",
    }, true);
    expect(out.max_output_tokens).toBe(64);
    expect(out.max_tokens).toBeUndefined();
    expect(out.reasoning).toEqual({ effort: "high", summary: "auto" });
    expect(out.store).toBe(false);
    expect(out.tool_choice).toBe("auto");
    expect(Array.isArray(out.input)).toBe(true);
    expect(String(out.instructions)).toContain("<env>");
    expect((out.tools as Rec[]).map(nameOf)).toEqual(["read", "shell"]);
  });
});

describe("OpenCodeExecutor transport", () => {
  it("sends the direct leg through the TLS client, not Node's fetch", async () => {
    const nativeFetch = vi.fn(async () => new Response("native", { status: 429 }));
    vi.stubGlobal("fetch", nativeFetch);
    const executor = new OpenCodeExecutor();
    const result = await executor.execute({
      model: "big-pickle",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials: { connectionId: "conn-tls" } as Credentials,
    });
    expect((result as { response: Response }).response.status).toBe(200);
    expect(opencodeTlsFetch).toHaveBeenCalled();
    const [url, init] = vi.mocked(opencodeTlsFetch).mock.calls.at(-1)!;
    expect(url).toBe("https://opencode.ai/inference/v1/chat/completions");
    expect(JSON.parse(String(init?.body)).tools.map(nameOf)).toEqual(["read", "shell"]);
  });

  it("proxyAwareFetch hands the direct leg to directFetch when no proxy is set", async () => {
    const directFetch = vi.fn(async () => new Response("ok"));
    await proxyAwareFetch("https://example.test/x", { method: "POST", directFetch });
    expect(directFetch).toHaveBeenCalledWith("https://example.test/x", { method: "POST" });
  });
});

describe("fingerprint restore on the forced SSE→JSON path", () => {
  it("returns caller tool names in the JSON response", async () => {
    const finalBody: Record<string, unknown> = {
      tools: [{ type: "function", function: { name: "read", parameters: { type: "object", properties: { file: {} } } } }],
    };
    applyFingerprintTools(finalBody, false);

    const sse = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read_client","arguments":"{\\"cmd\\":\\"ls\\"}"}}]}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      "data: [DONE]",
    ].join("\n\n");
    const providerResponse = new Response(sse, { headers: { "content-type": "text/event-stream" } });

    const result = await handleForcedSSEToJson({
      providerResponse,
      sourceFormat: "openai",
      targetFormat: "openai",
      provider: "opencode",
      model: "big-pickle",
      body: {},
      stream: false,
      translatedBody: {},
      finalBody,
      requestStartTime: Date.now(),
      connectionId: "conn-restore",
      apiKey: null,
      clientRawRequest: undefined,
      onRequestSuccess: undefined,
      customToolNames: undefined,
      trackDone: vi.fn(),
      appendLog: vi.fn(),
      reqTag: "test",
      log: undefined,
    } as unknown as Parameters<typeof handleForcedSSEToJson>[0]);

    expect(result?.success).toBe(true);
    const payload = await (result as { response: Response }).response.json();
    expect(payload.choices[0].message.tool_calls[0].function.name).toBe("read");
  });

  it("keeps rename maps anchored per body object", () => {
    const body: Record<string, unknown> = {};
    recordRenamedToolNames(body, new Map([["bash", "Bash"]]));
    expect(takeRenamedToolNames(body)?.get("bash")).toBe("Bash");
    expect(takeRenamedToolNames({ ...body })).toBeNull();
  });
});

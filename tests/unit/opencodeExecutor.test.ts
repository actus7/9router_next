import { describe, expect, it, vi } from "vitest";

import { MEMORY_CONFIG } from "@/server/llm-gateway/engine/config/runtimeConfig";
import {
  OpenCodeExecutor,
  buildOpencodeZenHeaders,
  buildOpencodeZenProbeRequest,
  generateRequestId,
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
import type { Credentials } from "@/server/llm-gateway/engine/services/types";

const SESSION_ID_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const REQUEST_ID_RE = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/;

vi.mock("@/server/llm-gateway/engine/host/usage", () => ({
  saveRequestDetail: vi.fn(async () => null),
  saveRequestUsage: vi.fn(async () => 1),
}));

describe("canonical session/request ids", () => {
  it("generates ses_ and msg_ ids in the exact console format", () => {
    expect(generateSessionId()).toMatch(SESSION_ID_RE);
    expect(generateRequestId()).toMatch(REQUEST_ID_RE);
  });

  it("is monotonically distinct per call", () => {
    const ids = new Set([generateSessionId(), generateSessionId(), generateRequestId(), generateRequestId()]);
    expect(ids.size).toBe(4);
  });
});

describe("hasValidOpencodeVersion", () => {
  it("accepts opencode/1.17.0 and newer", () => {
    expect(hasValidOpencodeVersion("opencode/1.17.0")).toBe(true);
    expect(hasValidOpencodeVersion("opencode/1.18.31")).toBe(true);
    expect(hasValidOpencodeVersion("opencode/2.0.0")).toBe(true);
    expect(hasValidOpencodeVersion("opencode/1.17")).toBe(true);
  });

  it("rejects unversioned, old and non-opencode agents", () => {
    expect(hasValidOpencodeVersion("opencode")).toBe(false);
    expect(hasValidOpencodeVersion("opencode/1.16.9")).toBe(false);
    expect(hasValidOpencodeVersion("Claude-Code/2.0")).toBe(false);
    expect(hasValidOpencodeVersion("")).toBe(false);
    expect(hasValidOpencodeVersion(undefined)).toBe(false);
  });
});

describe("stableOpencodeSessionId", () => {
  it("reuses one canonical session per connection", () => {
    const credentials = { connectionId: "conn-stable-1" } as Credentials;
    const first = stableOpencodeSessionId(credentials);
    const second = stableOpencodeSessionId(credentials);
    expect(first).toMatch(SESSION_ID_RE);
    expect(second).toBe(first);
  });

  it("issues distinct sessions per connection and per default bucket", () => {
    const a = stableOpencodeSessionId({ connectionId: "conn-stable-a" } as Credentials);
    const b = stableOpencodeSessionId({ connectionId: "conn-stable-b" } as Credentials);
    const fallback = stableOpencodeSessionId(null);
    expect(a).not.toBe(b);
    expect(a).not.toBe(fallback);
    expect(fallback).toMatch(SESSION_ID_RE);
  });

  it("expires the entry after MEMORY_CONFIG.sessionTtlMs", () => {
    const credentials = { connectionId: "conn-stable-ttl" } as Credentials;
    const first = stableOpencodeSessionId(credentials);
    const base = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(base + MEMORY_CONFIG.sessionTtlMs + 1000);
    try {
      const second = stableOpencodeSessionId(credentials);
      expect(second).not.toBe(first);
      expect(second).toMatch(SESSION_ID_RE);
    } finally {
      nowSpy.mockRestore();
    }
  });
});

describe("buildOpencodeZenHeaders", () => {
  it("replaces an invalid downstream UA with the versioned client UA", () => {
    expect(buildOpencodeZenHeaders({})["User-Agent"]).toBe("opencode/1.18.31");
    expect(buildOpencodeZenHeaders({ rawHeaders: { "user-agent": "opencode" } })["User-Agent"]).toBe("opencode/1.18.31");
    expect(buildOpencodeZenHeaders({ rawHeaders: { "user-agent": "opencode/1.16.0" } })["User-Agent"]).toBe("opencode/1.18.31");
    expect(buildOpencodeZenHeaders({ rawHeaders: { "user-agent": "curl/8.0" } })["User-Agent"]).toBe("opencode/1.18.31");
  });

  it("passes a downstream opencode/1.17.0+ UA through", () => {
    expect(buildOpencodeZenHeaders({ rawHeaders: { "user-agent": "opencode/1.18.0" } })["User-Agent"]).toBe("opencode/1.18.0");
  });

  it("reuses only canonical downstream sessions and generates stable ones otherwise", () => {
    const canonical = "ses_0123456789abAbCdEfGhIjKlMn";
    expect(canonical).toMatch(SESSION_ID_RE);
    expect(buildOpencodeZenHeaders({ rawHeaders: { "x-opencode-session": canonical } })["x-opencode-session"]).toBe(canonical);

    const credentials = { connectionId: "conn-headers-1" } as Credentials;
    const stale = `ses_${"a".repeat(32)}`; // old ses_<32hex> shape the gate rejects
    const first = buildOpencodeZenHeaders({ rawHeaders: { "x-opencode-session": stale }, credentials });
    const second = buildOpencodeZenHeaders({ credentials });
    expect(first["x-opencode-session"]).toMatch(SESSION_ID_RE);
    expect(first["x-opencode-session"]).not.toBe(stale);
    expect(second["x-opencode-session"]).toBe(first["x-opencode-session"]);
    expect(first["x-opencode-request"]).toMatch(REQUEST_ID_RE);
  });

  it("always authenticates as the public client", () => {
    const headers = buildOpencodeZenHeaders({});
    expect(headers.Authorization).toBe("Bearer public");
    expect(headers["x-opencode-client"]).toBe("desktop");
    expect(headers["x-opencode-project"]).toBe("global");
    expect(headers.Accept).toBe("text/event-stream");
  });

  it("adds anthropic-version only for /messages URLs", () => {
    expect(buildOpencodeZenHeaders({ url: "https://opencode.ai/zen/v1/messages" })["anthropic-version"]).toBe("2023-06-01");
    expect(buildOpencodeZenHeaders({ url: "https://opencode.ai/zen/v1/chat/completions" })["anthropic-version"]).toBeUndefined();
  });
});

describe("buildOpencodeZenProbeRequest", () => {
  it("probes the chat completions endpoint with the full fingerprint", () => {
    const probe = buildOpencodeZenProbeRequest();
    expect(probe.url).toBe("https://opencode.ai/zen/v1/chat/completions");
    expect(probe.body.stream).toBe(true);
    const names = (probe.body.tools as { function?: { name?: string } }[]).map((t) => t.function?.name);
    expect(new Set(names)).toEqual(new Set(["bash", "glob", "grep", "read"]));
    expect(probe.headers.Authorization).toBe("Bearer public");
    expect(probe.headers["User-Agent"]).toBe("opencode/1.18.31");
    expect(probe.headers["x-opencode-client"]).toBe("desktop");
    expect(probe.headers["x-opencode-session"]).toMatch(SESSION_ID_RE);
  });
});

describe("OpenCodeExecutor.transformRequest", () => {
  it("fingerprints the outbound body and anchors the rename map on it", () => {
    const executor = new OpenCodeExecutor();
    const body: Record<string, unknown> = {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "Bash", parameters: { type: "object", properties: {} } } }],
    };
    const out = executor.transformRequest("big-pickle", body, true, { connectionId: "conn-transform" } as Credentials);

    const map = takeRenamedToolNames(out);
    expect(map?.get("bash")).toBe("Bash");
    const names = (out.tools as { function?: { name?: string }; name?: string }[]).map((t) => t.function?.name ?? t.name);
    expect(new Set(names)).toEqual(new Set(["bash", "glob", "grep", "read"]));
    // The caller's own body keeps its tool list — only the outbound copy is fingerprinted.
    expect((body.tools as unknown[]).length).toBe(1);
  });

  it("uses the chat tool shape on chat-completions models", () => {
    const executor = new OpenCodeExecutor();
    const out = executor.transformRequest("big-pickle", { messages: [] }, true, { connectionId: "conn-transform-2" } as Credentials);
    const tools = out.tools as Record<string, unknown>[];
    expect(tools).toHaveLength(4);
    expect(tools[0].function).toBeDefined();
    expect(out.tool_choice).toBe("none");
  });
});

describe("fingerprint restore on the forced SSE→JSON path", () => {
  it("returns caller tool names in the JSON response", async () => {
    const finalBody: Record<string, unknown> = {
      tools: [{ type: "function", function: { name: "Bash", parameters: {} } }],
    };
    applyFingerprintTools(finalBody, false);

    const sse = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"bash","arguments":"{\\"cmd\\":\\"ls\\"}"}}]}}]}',
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
    expect(payload.choices[0].message.tool_calls[0].function.name).toBe("Bash");
  });

  it("keeps rename maps anchored per body object", () => {
    const body: Record<string, unknown> = {};
    recordRenamedToolNames(body, new Map([["bash", "Bash"]]));
    expect(takeRenamedToolNames(body)?.get("bash")).toBe("Bash");
    expect(takeRenamedToolNames({ ...body })).toBeNull();
  });
});

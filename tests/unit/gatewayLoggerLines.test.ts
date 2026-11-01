import { afterEach, describe, expect, it, vi } from "vitest";
import { maskUrlSecrets } from "@/server/llm-gateway/engine/utils/requestLogger";
import { createStreamController } from "@/server/llm-gateway/engine/utils/streamHandler";
import { handleExecutionError, handleUpstreamError } from "@/server/llm-gateway/engine/handlers/chatCore/upstreamErrors";

vi.mock("@/server/llm-gateway/engine/host/usage", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => null),
}));

const LOGGER = "@/server/llm-gateway/utils/logger";

async function loadLogger(level: string) {
  vi.stubEnv("LOG_LEVEL", level);
  vi.resetModules();
  return import(LOGGER);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("gateway logger line/errorLine", () => {
  it("exports line and errorLine", async () => {
    const log = await loadLogger("INFO");
    expect(typeof log.line).toBe("function");
    expect(typeof log.errorLine).toBe("function");
  });

  it("errorLine prints via console.error even with LOG_LEVEL=ERROR", async () => {
    const log = await loadLogger("ERROR");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    log.errorLine("tag", "x", "boom");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain("boom");
  });

  it("line is silent with LOG_LEVEL=ERROR", async () => {
    const log = await loadLogger("ERROR");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log.line("tag", "x", "hello");
    expect(spy).not.toHaveBeenCalled();
  });

  it("line prints via console.log with LOG_LEVEL=INFO", async () => {
    const log = await loadLogger("INFO");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log.line("tag", "x", "hello");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain("hello");
  });
});

describe("maskUrlSecrets", () => {
  it("masks the key query param and keeps the rest", () => {
    vi.stubEnv("LOG_UNMASKED_CREDENTIALS", "false");
    const out = maskUrlSecrets("https://x.googleapis.com/v1/m:generate?key=AIzaSyFAKEFAKEFAKEFAKEFAKE00&alt=sse");
    expect(out).toContain("key=***");
    expect(out).toContain("alt=sse");
    expect(out).not.toContain("AIzaSy");
  });
});

describe("upstream failure log boundaries", () => {
  const context = {
    provider: "test-provider",
    model: "test-model",
    connectionId: "test-connection",
    requestStartTime: 0,
    body: {},
    stream: true,
    translatedBody: {},
    pxpipeSummary: null,
    reqTag: "test-tag",
  };

  it("masks URL query credentials and redacts an upstream error before console output", async () => {
    vi.stubEnv("LOG_UNMASKED_CREDENTIALS", "false");
    const log = await loadLogger("ERROR");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const queryValue = "synthetic-query-credential";
    const errorValue = "sk-synthetic-upstream-error-0000";

    const result = await handleUpstreamError({
      ...context,
      providerResponse: new Response(JSON.stringify({ error: { message: `upstream rejected ${errorValue}` } }), { status: 502 }),
      providerUrl: `https://provider.example/v1/chat?key=${queryValue}&alt=sse`,
      executor: {} as Parameters<typeof handleUpstreamError>[0]["executor"],
      finalBody: undefined,
      log,
      reqLogger: { logError: vi.fn() } as unknown as Parameters<typeof handleUpstreamError>[0]["reqLogger"],
    });

    expect(result.status).toBe(502);
    expect(spy).toHaveBeenCalledTimes(1);
    const output = String(spy.mock.calls[0][0]);
    expect(output).toContain("ERROR 502 · test-provider/test-model");
    expect(output).toContain("key=***&alt=sse");
    expect(output).toContain("upstream rejected [redacted]");
    expect(output).not.toContain(queryValue);
    expect(output).not.toContain(errorValue);
  });

  it("redacts both the execution error message and its stack before console output", async () => {
    const log = await loadLogger("ERROR");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const messageValue = "sk-synthetic-execution-error-0000";
    const stackValue = "Bearer synthetic-stack-credential-0000";
    const error = new Error(`execution failed ${messageValue}`);
    error.stack = `Error: execution failed ${messageValue}\n    at upstream (${stackValue})`;

    const result = await handleExecutionError({
      ...context,
      error,
      log,
      streamController: createStreamController(),
    });

    expect(result.status).toBe(502);
    expect(spy).toHaveBeenCalledTimes(1);
    const output = String(spy.mock.calls[0][0]);
    expect(output).toContain("execution failed [redacted]");
    expect(output).toContain("at upstream ([redacted])");
    expect(output).not.toContain(messageValue);
    expect(output).not.toContain(stackValue);
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  resolveProbePlan,
  runProbePlan,
  type ProbeFetch,
  type ProbePlan,
} from "@/server/llm-gateway/probe/probeCredential";

/** Records what the engine decided to send and answers with a status. */
function fetcher(status: number): { send: ProbeFetch; calls: Array<[string, RequestInit | undefined]> } {
  const calls: Array<[string, RequestInit | undefined]> = [];
  const send: ProbeFetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    return new Response("{}", { status });
  });
  return { send, calls };
}

function headerOf(init: RequestInit | undefined, name: string): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.[name];
}

describe("resolveProbePlan", () => {
  it("returns the declared plan for a provider that has one", () => {
    const plan = resolveProbePlan("openai");
    expect(plan?.strategy).toBe("bearer-get");
    expect(plan?.url).toContain("/models");
  });

  it("uses the Anthropic wire format where the provider needs it", () => {
    const plan = resolveProbePlan("anthropic");
    expect(plan?.strategy).toBe("anthropic-post");
    // Anthropic answers 403 for a valid key without access to the model.
    expect(plan?.rejected?.has(403)).toBe(false);
    expect(plan?.rejected?.has(401)).toBe(true);
  });

  it("resolves an alias to the same plan as its target", () => {
    expect(resolveProbePlan("naga")?.url).toBe(resolveProbePlan("naga-ac")?.url);
  });
});

describe("runProbePlan", () => {
  it("sends Bearer auth and accepts a 200 on a listing probe", async () => {
    const { send, calls } = fetcher(200);
    const plan: ProbePlan = { strategy: "bearer-get", url: "https://example.test/v1/models" };

    const result = await runProbePlan("openai", plan, "sk-abc", send);

    expect(result.ok).toBe(true);
    expect(headerOf(calls[0][1], "Authorization")).toBe("Bearer sk-abc");
  });

  it("honours a non-Bearer auth scheme", async () => {
    const { send, calls } = fetcher(200);
    const plan: ProbePlan = { strategy: "custom-prefix", url: "https://example.test/x", authPrefix: "Token " };

    await runProbePlan("deepgram", plan, "dg-key", send);

    expect(headerOf(calls[0][1], "Authorization")).toBe("Token dg-key");
  });

  it("sends the key as a header name instead of a scheme when asked", async () => {
    const { send, calls } = fetcher(200);
    const plan: ProbePlan = { strategy: "bearer-get", url: "https://example.test/v1/models", apiKeyHeader: true };

    await runProbePlan("some-provider", plan, "k", send);

    expect(headerOf(calls[0][1], "X-API-Key")).toBe("k");
    expect(headerOf(calls[0][1], "Authorization")).toBeUndefined();
  });

  it("reads a 401 as a refused credential", async () => {
    const { send } = fetcher(401);
    const plan: ProbePlan = { strategy: "bearer-get", url: "https://example.test/v1/models" };

    const result = await runProbePlan("openai", plan, "bad", send);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it("reads a 400 on a chat probe as an accepted credential", async () => {
    const { send } = fetcher(400);
    const plan: ProbePlan = { strategy: "chat-post", url: "https://example.test/v1/chat/completions" };

    // The request was malformed for that provider, but auth already passed.
    const result = await runProbePlan("glm-cn", plan, "k", send);

    expect(result.ok).toBe(true);
  });

  it("puts the key in the query string for a query-key provider", async () => {
    const { send, calls } = fetcher(200);
    const plan: ProbePlan = { strategy: "query-key", url: "https://example.test/v1/models" };

    await runProbePlan("gemini", plan, "g key", send);

    expect(calls[0][0]).toBe("https://example.test/v1/models?key=g%20key");
  });

  it("keeps a declared rejected set instead of the default", async () => {
    const { send } = fetcher(403);
    const plan: ProbePlan = {
      strategy: "anthropic-post",
      url: "https://example.test/v1/messages",
      model: "m",
      rejected: new Set([401]),
    };

    const result = await runProbePlan("anthropic", plan, "k", send);

    expect(result.ok).toBe(true);
  });
});

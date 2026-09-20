import { describe, expect, it, vi } from "vitest";

/**
 * A model reached through a fan-out alias (kilo-gateway, OpenRouter) can have
 * no endpoint behind it that does tool calling — every `:free` variant of
 * `z-ai/glm-5.2` was one. The session's plugins put `tools` on every request,
 * so a turn that never needed a tool died with a 404 the user could do nothing
 * about but guess which switch to flip.
 */

import { retryWithoutTools, bodyHasTools } from "@/server/llm-gateway/engine/handlers/chatCore/upstreamErrors";
import { isClientRequestError } from "@/server/llm-gateway/engine/services/accountFallback";

const KILO_404 = JSON.stringify({
  error: { message: 'No endpoints found that support tool use. Try disabling "web_search".' },
});

type ExecuteArgs = { body: Record<string, unknown> };

function callRetry(executor: unknown, response: Response, translatedBody: Record<string, unknown>) {
  return retryWithoutTools({
    // The helper only uses `execute`; the full executor shape is irrelevant here.
    executor: executor as Parameters<typeof retryWithoutTools>[0]["executor"],
    providerResponse: response,
    providerUrl: "https://api.kilo.ai/api/gateway/chat/completions",
    providerResponseFormat: "openai",
    translatedBody,
    executeParams: {
      model: "z-ai/glm-5.2:free",
      stream: false,
      credentials: {} as never,
      signal: new AbortController().signal,
      proxyOptions: {},
    },
    provider: "kilo-gateway",
    model: "z-ai/glm-5.2:free",
    reqTag: "test",
  });
}

const withTools = () => ({
  model: "z-ai/glm-5.2:free",
  messages: [{ role: "user", content: "Oi" }],
  tools: [{ type: "function", function: { name: "web_search" } }],
  tool_choice: "auto",
});

describe("retryWithoutTools", () => {
  it("re-sends the turn without tools when the upstream says no endpoint supports them", async () => {
    const execute = vi.fn(async ({ body }: ExecuteArgs) => ({
      response: new Response("{}", { status: 200 }),
      url: "u",
      responseFormat: "openai",
      transformedBody: body,
    }));

    const result = await callRetry({ execute }, new Response(KILO_404, { status: 404 }), withTools());

    expect(execute).toHaveBeenCalledTimes(1);
    const sent = execute.mock.calls[0][0].body;
    expect(sent.tools).toBeUndefined();
    expect(sent.tool_choice).toBeUndefined();
    expect(sent.messages).toHaveLength(1);
    expect(result.providerResponse.status).toBe(200);
    expect(result.translatedBody.tools).toBeUndefined();
  });

  it("strips tools nested under Gemini's `request` wrapper", async () => {
    const execute = vi.fn(async ({ body }: ExecuteArgs) => ({
      response: new Response("{}", { status: 200 }),
      url: "u",
      transformedBody: body,
    }));

    await callRetry({ execute }, new Response(KILO_404, { status: 404 }), {
      request: { contents: [], tools: [{ functionDeclarations: [] }], toolConfig: {} },
    });

    const sent = execute.mock.calls[0][0].body.request as Record<string, unknown>;
    expect(sent.tools).toBeUndefined();
    expect(sent.toolConfig).toBeUndefined();
    expect(sent.contents).toEqual([]);
  });

  it("leaves an unrelated error alone, and hands back a readable response", async () => {
    const execute = vi.fn();
    const body = JSON.stringify({ error: { message: "Insufficient credits" } });

    const result = await callRetry({ execute }, new Response(body, { status: 402 }), withTools());

    expect(execute).not.toHaveBeenCalled();
    expect(result.providerResponse.status).toBe(402);
    // The original response was consumed to read the error; the caller still
    // has to be able to parse it.
    await expect(result.providerResponse.text()).resolves.toBe(body);
  });

  /**
   * Observed live: the retry was rate-limited, and reporting the tool-use 404
   * over it told the user to go looking for a plugin switch when the answer was
   * to wait — and denied the account the 429 backoff, since cooldowns are
   * classified from the status that comes back.
   */
  it("reports the retry's own failure, not the error it already worked around", async () => {
    const execute = vi.fn(async () => ({ response: new Response("slow down", { status: 429 }), url: "u" }));

    const result = await callRetry({ execute }, new Response(KILO_404, { status: 404 }), withTools());

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.providerResponse.status).toBe(429);
    expect(result.translatedBody.tools).toBeUndefined();
  });

  it("falls back to the original error when the retry never answers", async () => {
    const execute = vi.fn(async () => { throw new Error("socket hang up"); });

    const result = await callRetry({ execute }, new Response(KILO_404, { status: 404 }), withTools());

    expect(result.providerResponse.status).toBe(404);
    await expect(result.providerResponse.text()).resolves.toBe(KILO_404);
    expect(result.translatedBody.tools).toBeDefined();
  });
});

describe("bodyHasTools", () => {
  it("is false for a request that never asked for tool calling", () => {
    expect(bodyHasTools({ messages: [] })).toBe(false);
    expect(bodyHasTools({ tools: [] })).toBe(false);
    expect(bodyHasTools({ request: { contents: [] } })).toBe(false);
  });

  it("is true at the top level and under Gemini's wrapper", () => {
    expect(bodyHasTools({ tools: [{ type: "function" }] })).toBe(true);
    expect(bodyHasTools({ request: { tools: [{ functionDeclarations: [] }] } })).toBe(true);
  });
});

describe("account rotation", () => {
  /**
   * The 404 cooled the only kilo account down for two minutes, so every message
   * after it was answered by the free default provider instead — the prompt
   * silently went somewhere the user never picked. Rotating accounts cannot
   * help: the next one has the same endpoints behind the same alias.
   */
  it("does not rotate accounts when the model has no tool-calling endpoint", () => {
    expect(isClientRequestError(404, 'No endpoints found that support tool use. Try disabling "web_search".')).toBe(true);
  });

  it("still rotates on a plain 404, which does mean 'not on this account'", () => {
    expect(isClientRequestError(404, "Model not found")).toBe(false);
    expect(isClientRequestError(404)).toBe(false);
  });
});

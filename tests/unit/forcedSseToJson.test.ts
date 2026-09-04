import { describe, expect, it, vi } from "vitest";

import { handleForcedSSEToJson } from "@/server/llm-gateway/engine/handlers/chatCore/sseToJsonHandler";

type Params = Parameters<typeof handleForcedSSEToJson>[0];

function contextFor(providerResponse: Response): Params {
  return {
    providerResponse,
    sourceFormat: "openai",
    targetFormat: "openai",
    provider: "openai-compatible",
    model: "some-model",
    body: {},
    stream: true,
    translatedBody: {},
    finalBody: {},
    requestStartTime: Date.now(),
    connectionId: "conn-1",
    apiKey: null,
    clientRawRequest: null,
    onRequestSuccess: undefined,
    customToolNames: undefined,
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    reqTag: "test",
    log: undefined,
  } as unknown as Params;
}

describe("handleForcedSSEToJson", () => {
  // chatCore falls back to the JSON response handler when this returns null,
  // which is only safe because the body has not been read at that point.
  it("declines a non-SSE upstream response without consuming its body", async () => {
    const providerResponse = new Response(JSON.stringify({ id: "resp-1" }), {
      headers: { "content-type": "application/json" },
    });
    const context = contextFor(providerResponse);

    expect(await handleForcedSSEToJson(context)).toBeNull();
    expect(providerResponse.bodyUsed).toBe(false);
    expect(context.trackDone).not.toHaveBeenCalled();
    await expect(providerResponse.json()).resolves.toEqual({ id: "resp-1" });
  });
});

import { beforeEach, describe, expect, it } from "vitest";

import { createSSETransformStreamWithLogger } from "@/server/llm-gateway/engine/utils/stream";
import { FORMATS } from "@/server/llm-gateway/engine/translator/formats";
import { _clearThoughtSignatures, getGeminiThoughtSignatureSync } from "@/server/llm-gateway/engine/services/thoughtSignatureStore";

/**
 * The response stream knows the request's session; without it two sessions
 * reusing a tool_call_id would share a signature.
 */
beforeEach(() => _clearThoughtSignatures());

async function pipe(sse: string, sessionId: string | null) {
  const stream = createSSETransformStreamWithLogger(
    FORMATS.ANTIGRAVITY, FORMATS.OPENAI, "antigravity", null, null, "gemini-3.1-pro-low", "conn-1", null, null, null, null, sessionId,
  );
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const drained = (async () => { while (!(await reader.read()).done) { /* drain */ } })();
  await writer.write(new TextEncoder().encode(sse));
  await writer.close();
  await drained;
}

const sseWith = (signature: string) => `data: ${JSON.stringify({
  response: {
    responseId: "r1",
    modelVersion: "gemini-3.1-pro-low",
    candidates: [{ content: { parts: [{ thoughtSignature: signature, functionCall: { id: "call-s", name: "read_file", args: {} } }] }, finishReason: "STOP" }],
  },
})}

`;

describe("response stream", () => {
  it("keeps each session's signature when two sessions reuse a tool_call_id", async () => {
    await pipe(sseWith("sig-A"), "sess-1");
    await pipe(sseWith("sig-B"), "sess-2");

    expect(getGeminiThoughtSignatureSync("call-s", "sess-1", "gemini-3.1-pro-low")).toBe("sig-A");
    expect(getGeminiThoughtSignatureSync("call-s", "sess-2", "gemini-3.1-pro-low")).toBe("sig-B");
  });
});

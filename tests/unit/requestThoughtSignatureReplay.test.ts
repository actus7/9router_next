import { beforeEach, describe, expect, it } from "vitest";

import { translateRequest } from "@/server/llm-gateway/engine/translator";
import { FORMATS } from "@/server/llm-gateway/engine/translator/formats";
import { AntigravityExecutor } from "@/server/llm-gateway/engine/executors/antigravity";
import { _clearThoughtSignatures, storeGeminiThoughtSignature } from "@/server/llm-gateway/engine/services/thoughtSignatureStore";

/**
 * A replayed tool call carries the signature Gemini produced for it. Parallel
 * calls only need the first one signed; the stand-in signature is the fallback
 * for a call that has none cached (ported from decolua/9router c08efdb/bc3be0c).
 */
const credentials = { projectId: "p-1", email: "a@b.c", connectionId: "c-1" };
const MODEL = "gemini-3.1-pro-low";

const history = (ids: string[]) => ({
  messages: [
    { role: "user", content: "go" },
    { role: "assistant", content: "", tool_calls: ids.map((id) => ({ id, type: "function", function: { name: "read_file", arguments: "{}" } })) },
    ...ids.map((id) => ({ role: "tool", tool_call_id: id, content: "ok" })),
  ],
});

type Part = { thoughtSignature?: string; functionCall?: { id: string } };

function callParts(body: Record<string, unknown>, viaExecutor: boolean): Part[] {
  let envelope = translateRequest(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, MODEL, body, false, { ...credentials }) as Record<string, unknown>;
  if (viaExecutor) {
    envelope = new AntigravityExecutor().transformRequest(MODEL, envelope, false, credentials as never) as Record<string, unknown>;
  }
  const contents = (envelope.request as { contents: Array<{ parts: Part[] }> }).contents;
  return contents.flatMap((c) => c.parts).filter((p) => p.functionCall);
}

beforeEach(() => _clearThoughtSignatures());

describe.each([[false], [true]])("tool call replay (executor=%s)", (viaExecutor) => {
  it("replays the cached signature", () => {
    storeGeminiThoughtSignature("call-1", "sig-real", null, MODEL);

    expect(callParts(history(["call-1"]), viaExecutor)[0].thoughtSignature).toBe("sig-real");
  });

  it("signs only the first of several parallel calls with the stand-in", () => {
    const parts = callParts(history(["call-1", "call-2"]), viaExecutor);

    expect(parts[0].thoughtSignature).toBeTruthy(); // the stand-in
    expect(parts[1].thoughtSignature).toBeUndefined();
  });

  it("does not replay a signature produced by another family", () => {
    storeGeminiThoughtSignature("call-1", "sig-claude", null, "claude-sonnet-4-6");

    const signature = callParts(history(["call-1"]), viaExecutor)[0].thoughtSignature;

    expect(signature).toBeTruthy();
    expect(signature).not.toBe("sig-claude");
  });
});

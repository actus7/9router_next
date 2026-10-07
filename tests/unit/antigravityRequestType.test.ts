import { describe, expect, it } from "vitest";

import { translateRequest } from "@/server/llm-gateway/engine/translator";
import { FORMATS } from "@/server/llm-gateway/engine/translator/formats";
import { AntigravityExecutor } from "@/server/llm-gateway/engine/executors/antigravity";

/**
 * The official Antigravity client omits `requestType` on the agent (chat)
 * path. Sending "agent" makes Google bucket the call and answer a detail-free
 * 429 RESOURCE_EXHAUSTED even with quota left. image_gen keeps its own value.
 */
const credentials = { projectId: "p-1", email: "a@b.c", connectionId: "c-1" };
const chat = { messages: [{ role: "user", content: "oi" }] };

describe("antigravity envelope", () => {
  it.each(["gemini-3-pro-high", "claude-sonnet-4-5"])("translator sends no requestType for %s", (model) => {
    const envelope = translateRequest(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, model, structuredClone(chat), false, credentials) as Record<string, unknown>;

    expect(envelope).not.toHaveProperty("requestType");
    expect(envelope.userAgent).toBe("antigravity");
  });

  it("executor drops requestType, even one leaking in from the incoming envelope", () => {
    const executor = new AntigravityExecutor();
    const envelope = translateRequest(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, "gemini-3-pro-high", structuredClone(chat), false, credentials) as Record<string, unknown>;
    envelope.requestType = "agent";

    const out = executor.transformRequest("gemini-3-pro-high", envelope, false, credentials as never) as Record<string, unknown>;

    expect(out).not.toHaveProperty("requestType");
  });
});

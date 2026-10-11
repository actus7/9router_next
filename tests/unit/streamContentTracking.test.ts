import { describe, expect, it } from "vitest";
import { trackContent } from "@/server/llm-gateway/engine/utils/streamContent";

const fresh = () => ({ totalContentLength: 0, accumulatedContent: "", accumulatedThinking: "", sawToolCall: false, toolCalls: [] as string[] });

// Found by gatewayDockerLive: Codex streams the Responses API. The client got
// the translated text, but the request drawer recorded "[Empty streaming
// response]" because the tracker only knew Claude, Chat and Gemini events.
describe("stream content tracking", () => {
  it("accumulates Responses API text and reasoning deltas", () => {
    const ctx = fresh();
    trackContent(ctx, { type: "response.reasoning_summary_text.delta", delta: "Think. " });
    trackContent(ctx, { type: "response.output_text.delta", delta: "Root 2 " });
    trackContent(ctx, { type: "response.output_text.delta", delta: "is irrational." });
    trackContent(ctx, { type: "response.output_text.done", text: "Root 2 is irrational." });
    expect(ctx.accumulatedContent).toBe("Root 2 is irrational.");
    expect(ctx.accumulatedThinking).toBe("Think. ");
  });

  it("still reads Claude, Chat and Gemini chunks", () => {
    const ctx = fresh();
    trackContent(ctx, { delta: { text: "a" } });
    trackContent(ctx, { choices: [{ delta: { content: "b", reasoning_content: "r" } }] });
    trackContent(ctx, { candidates: [{ content: { parts: [{ text: "c" }, { text: "t", thought: true }] } }] });
    expect(ctx.accumulatedContent).toBe("abc");
    expect(ctx.accumulatedThinking).toBe("rt");
  });
});

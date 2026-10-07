import { describe, expect, it } from "vitest";

import { translateRequest } from "@/server/llm-gateway/engine/translator";
import { FORMATS } from "@/server/llm-gateway/engine/translator/formats";
import { AntigravityExecutor } from "@/server/llm-gateway/engine/executors/antigravity";

/**
 * Gemini rejects empty parts, two turns of one role in a row, a conversation
 * that opens on the model, and a function call with no matching response
 * (ported from decolua/9router e7b5f09).
 */
const credentials = { projectId: "p-1", email: "a@b.c", connectionId: "c-1" };
const MODEL = "gemini-3.1-pro-low";

type Turn = { role: string; parts: Array<Record<string, unknown>> };

function contentsOf(messages: unknown[]): Turn[] {
  const env = translateRequest(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, MODEL, { messages }, false, { ...credentials }) as Record<string, unknown>;
  return (env.request as { contents: Turn[] }).contents;
}

describe("translator", () => {
  it("answers an intermediate tool call that never got a result, instead of dropping it", () => {
    const contents = contentsOf([
      { role: "user", content: "go" },
      { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: "{}" } }] },
      { role: "user", content: "never mind, do this instead" },
    ]);

    const responses = contents.flatMap((t) => t.parts).filter((p) => p.functionResponse);
    expect(responses).toHaveLength(1);
    expect((responses[0].functionResponse as { id: string }).id).toBe("c1");
  });

  it("treats a falsy tool result as a result, not a missing one", () => {
    const contents = contentsOf([
      { role: "user", content: "go" },
      { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: "" },
    ]);

    expect(contents.flatMap((t) => t.parts).filter((p) => p.functionResponse)).toHaveLength(1);
  });
});

describe("executor contents", () => {
  const run = (contents: Turn[]) => {
    const body = { model: MODEL, request: { contents } };
    return ((new AntigravityExecutor().transformRequest(MODEL, body, false, credentials as never) as Record<string, unknown>).request as { contents: Turn[] }).contents;
  };

  it("merges adjacent turns of the same role and drops empty parts", () => {
    const out = run([
      { role: "user", parts: [{ text: "a" }, {}] },
      { role: "user", parts: [{ text: "b" }] },
      { role: "model", parts: [{}] },
    ]);

    expect(out).toEqual([{ role: "user", parts: [{ text: "a" }, { text: "b" }] }]);
  });

  it("opens with a user turn when the conversation starts on the model", () => {
    const out = run([{ role: "model", parts: [{ text: "hi" }] }]);

    expect(out[0].role).toBe("user");
    expect(out[1].role).toBe("model");
  });
});

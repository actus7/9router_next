import { describe, expect, it } from "vitest";

import { __test__ as sseToJson } from "@/server/llm-gateway/engine/handlers/chatCore/sseToJsonHandler";

// The Responses translator writes `_customToolNames` as an array of names
// (`[...set]`), and the SSE→JSON path used to call `.has()` on it. That threw
// for any client using custom tools against a provider that forces streaming.
const CUSTOM_TOOL_NAMES: string[] = ["run_shell"];

function completionWithToolCall(name: string) {
  return {
    id: "chatcmpl-1",
    model: "some-model",
    choices: [{
      message: {
        content: "",
        tool_calls: [{ id: "call_1", function: { name, arguments: "{\"a\":1}" } }],
      },
    }],
    usage: {},
  };
}

describe("chat completion to Responses conversion", () => {
  it("marks a tool the client declared custom as a custom tool call", () => {
    const result = sseToJson.chatCompletionToResponses(
      completionWithToolCall("run_shell"),
      CUSTOM_TOOL_NAMES,
    );
    const output = result.output as Array<Record<string, unknown>>;
    expect(output[0].type).toBe("custom_tool_call");
    expect(output[0].name).toBe("run_shell");
  });

  it("leaves a regular tool as a function call", () => {
    const result = sseToJson.chatCompletionToResponses(
      completionWithToolCall("get_weather"),
      CUSTOM_TOOL_NAMES,
    );
    const output = result.output as Array<Record<string, unknown>>;
    expect(output[0].type).toBe("function_call");
    expect(output[0].arguments).toBe("{\"a\":1}");
  });

  it("treats a missing custom tool list as no custom tools", () => {
    const result = sseToJson.chatCompletionToResponses(completionWithToolCall("run_shell"), null);
    const output = result.output as Array<Record<string, unknown>>;
    expect(output[0].type).toBe("function_call");
  });
});

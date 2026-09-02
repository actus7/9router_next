import { describe, expect, it } from "vitest";
import { buildChatFetchOptions, buildRequestMessages } from "@/app/(dashboard)/dashboard/basic-chat/hooks/buildChatRequest";
import type { ChatMessage, NormalizedModel } from "@/app/(dashboard)/dashboard/basic-chat/types";
import { runtimeToolDefinitions } from "@/app/(dashboard)/dashboard/basic-chat/hooks/runtimeToolDefinitions";

const model: NormalizedModel = {
  id: "provider:model", requestModel: "model", name: "Model", providerId: "provider", providerName: "Provider", source: "configured",
};

describe("buildChatRequest", () => {
  it("preserves assistant calls and their tool result messages", () => {
    const messages: ChatMessage[] = [
      { id: "user", role: "user", content: "inspect the project" },
      { id: "assistant", role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "list_files", arguments: '{"path":"."}' }] },
      { id: "result", role: "tool", toolCallId: "call_1", content: '{"ok":true,"entries":["README.md"]}' },
      { id: "placeholder", role: "assistant", content: "" },
    ];

    expect(buildRequestMessages(messages, "placeholder", "")).toEqual([
      { role: "user", content: "inspect the project" },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "list_files", arguments: '{"path":"."}' } }] },
      { role: "tool", tool_call_id: "call_1", content: '{"ok":true,"entries":["README.md"]}' },
    ]);
  });

  it("only includes ephemeral runtime tools supplied by the caller", () => {
    const request = buildChatFetchOptions(model, [], 0.7, "", new AbortController().signal, runtimeToolDefinitions);
    const body = JSON.parse(String(request.body));
    expect(body.tools).toEqual(runtimeToolDefinitions);
    expect(body.tools).toHaveLength(runtimeToolDefinitions.length);
    expect(body.tool_choice).toBe("auto");
  });

  it("includes reasoning_effort in the request body when set, omits it when null", () => {
    const withEffort = buildChatFetchOptions(model, [], 0.7, "", new AbortController().signal, undefined, "high");
    expect(JSON.parse(String(withEffort.body)).reasoning_effort).toBe("high");

    const withoutEffort = buildChatFetchOptions(model, [], 0.7, "", new AbortController().signal, undefined, null);
    expect(JSON.parse(String(withoutEffort.body))).not.toHaveProperty("reasoning_effort");
  });
});

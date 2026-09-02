import { describe, expect, it } from "vitest";
import { collectToolCallDeltas } from "@/app/(dashboard)/dashboard/basic-chat/hooks/consumeSSEStream";

describe("collectToolCallDeltas", () => {
  it("reassembles streamed native tool calls by their index", () => {
    const calls = new Map<number, { id: string; name: string; arguments: string }>();

    collectToolCallDeltas(calls, [{ index: 0, id: "call_1", function: { name: "read_file", arguments: '{"path":' } }]);
    collectToolCallDeltas(calls, [{ index: 0, function: { arguments: '"README.md"}' } }]);

    expect(Array.from(calls.values())).toEqual([
      { id: "call_1", name: "read_file", arguments: '{"path":"README.md"}' },
    ]);
  });

  it("keeps parallel calls separate", () => {
    const calls = new Map<number, { id: string; name: string; arguments: string }>();

    collectToolCallDeltas(calls, [
      { index: 1, id: "call_b", function: { name: "search_files", arguments: '{"q":"todo"}' } },
      { index: 0, id: "call_a", function: { name: "list_files", arguments: "{}" } },
    ]);

    expect(Array.from(calls.values())).toEqual([
      { id: "call_b", name: "search_files", arguments: '{"q":"todo"}' },
      { id: "call_a", name: "list_files", arguments: "{}" },
    ]);
  });
});

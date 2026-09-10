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

  it("keeps parallel calls separate when the provider omits the index", () => {
    // Nothing in the SSE contract makes `index` mandatory, and it was the only
    // key: two calls in indexless frames both landed in slot 0, so the second
    // overwrote the first's id and name and their arguments were concatenated
    // into one unparseable string. The first tool vanished with no trace.
    const calls = new Map<number | string, { id: string; name: string; arguments: string }>();

    collectToolCallDeltas(calls, [{ id: "call_a", function: { name: "web_search", arguments: '{"q":"x"}' } }]);
    collectToolCallDeltas(calls, [{ id: "call_b", function: { name: "web_fetch", arguments: '{"url":"y"}' } }]);

    expect(Array.from(calls.values())).toEqual([
      { id: "call_a", name: "web_search", arguments: '{"q":"x"}' },
      { id: "call_b", name: "web_fetch", arguments: '{"url":"y"}' },
    ]);
  });

  it("still merges continuation frames that carry only the index", () => {
    // The id arrives once, on the opening frame; later frames of the same call
    // carry `index` alone, so keying by id must not lose them.
    const calls = new Map<number | string, { id: string; name: string; arguments: string }>();

    collectToolCallDeltas(calls, [{ index: 0, id: "call_1", function: { name: "read_file", arguments: '{"p":' } }]);
    collectToolCallDeltas(calls, [{ index: 0, function: { arguments: '"a"}' } }]);

    expect(Array.from(calls.values())).toEqual([
      { id: "call_1", name: "read_file", arguments: '{"p":"a"}' },
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

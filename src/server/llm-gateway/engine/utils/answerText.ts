// The assistant's final text, and whether it called a tool, from a complete
// (non-streamed) response in any client dialect. Used by the Synapse Loop,
// which must learn only from plain answers.

type Json = Record<string, unknown>;

const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);

export function answerOf(response: unknown): { text: string; sawToolCall: boolean } {
  const r = (response && typeof response === "object" ? response : {}) as Json;

  const choice = arr(r.choices)[0];
  if (choice) {
    const message = (choice.message || {}) as Json;
    return { text: typeof message.content === "string" ? message.content : "", sawToolCall: arr(message.tool_calls).length > 0 };
  }
  if (r.type === "message" && Array.isArray(r.content)) {
    const blocks = arr(r.content);
    return {
      text: blocks.filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join(""),
      sawToolCall: blocks.some((b) => b.type === "tool_use"),
    };
  }
  if (Array.isArray(r.output)) {
    const items = arr(r.output);
    return {
      text: items.filter((i) => i.type === "message").flatMap((i) => arr(i.content)).map((c) => String(c.text ?? "")).join(""),
      sawToolCall: items.some((i) => i.type === "function_call" || i.type === "custom_tool_call"),
    };
  }
  const parts = arr(((arr(r.candidates)[0]?.content || {}) as Json).parts);
  if (parts.length) {
    return {
      text: parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => String(p.text)).join(""),
      sawToolCall: parts.some((p) => !!p.functionCall),
    };
  }
  return { text: "", sawToolCall: false };
}

/** Whether one streamed chunk (any upstream dialect) carries a tool call. */
export function chunkHasToolCall(chunk: unknown): boolean {
  const c = (chunk && typeof chunk === "object" ? chunk : {}) as Json;
  const delta = (arr(c.choices)[0]?.delta || {}) as Json;
  if (arr(delta.tool_calls).length) return true;
  if ((c.content_block as Json | undefined)?.type === "tool_use") return true;
  if (c.delta && (c.delta as Json).type === "input_json_delta") return true;
  const item = c.item as Json | undefined;
  if (item?.type === "function_call" || item?.type === "custom_tool_call") return true;
  return arr(((arr(c.candidates)[0]?.content || {}) as Json).parts).some((p) => !!p.functionCall);
}

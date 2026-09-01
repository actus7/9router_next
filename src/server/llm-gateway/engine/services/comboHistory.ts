import { extractTextContent } from "../translator/formats/gemini";

// Prefixes used when flattening tool turns into plain prose for panel models.
const TOOL_CALL_PREFIX = "[Called tools: ";
const TOOL_RESULT_PREFIX = "[Tool result: ";

// Flatten tool turns into prose so panel models keep the context but can't loop
// on tools: drop the request's tools, turn tool/function results into assistant
// text, and inline assistant tool_calls names instead of the structured field.
export function flattenToolHistory(messages: Record<string, unknown>[]): Record<string, unknown>[] {
  return messages
    .filter((msg: Record<string, unknown>) => msg)
    .map((msg: Record<string, unknown>) => {
      if (msg.role === "tool" || msg.role === "function") {
        return { role: "assistant", content: `${TOOL_RESULT_PREFIX}${extractTextContent(msg.content as string | Record<string, unknown>[]) || String(msg.content ?? "")}]` };
      }
      if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
        const { tool_calls, ...rest } = msg;
        const names = (tool_calls as Record<string, unknown>[]).map((c: Record<string, unknown>) => (c?.function as Record<string, unknown>)?.name || c?.name || "tool").join(", ");
        const base = extractTextContent(rest.content as string | Record<string, unknown>[]) || (typeof rest.content === "string" ? rest.content : "");
        return { ...rest, content: `${base}${base ? "\n" : ""}${TOOL_CALL_PREFIX}${names}]` };
      }
      if (Array.isArray(msg.content)) {
        const hasToolUse = (msg.content as Record<string, unknown>[]).some((c: Record<string, unknown>) => c.type === "tool_use");
        const hasToolResult = (msg.content as Record<string, unknown>[]).some((c: Record<string, unknown>) => c.type === "tool_result");
        if (hasToolUse || hasToolResult) {
          const textParts: string[] = [];
          const toolNames: string[] = [];
          const toolResults: string[] = [];
          for (const block of msg.content as Record<string, unknown>[]) {
            if (block.type === "text" && block.text) textParts.push(block.text as string);
            if (block.type === "tool_use") toolNames.push((block.name as string) || "tool");
            if (block.type === "tool_result") toolResults.push(extractTextContent(block.content as string | Record<string, unknown>[]) || String(block.content ?? ""));
          }
          const { ...rest } = msg;
          let newContent = textParts.join("\n");
          if (toolNames.length > 0) {
            newContent = `${newContent}${newContent ? "\n" : ""}${TOOL_CALL_PREFIX}${toolNames.join(", ")}]`;
          }
          if (toolResults.length > 0) {
            newContent = `${newContent}${newContent ? "\n" : ""}${TOOL_RESULT_PREFIX}${toolResults.join("\n")}]`;
          }
          return { ...rest, content: newContent };
        }
      }
      return msg;
    });
}


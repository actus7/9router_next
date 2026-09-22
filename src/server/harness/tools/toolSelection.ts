import "server-only";

import { evaluateJev, isJevFeatureEnabled, type JevQuestion } from "@/server/decisions/jev";

// A conversation's `tools` are whatever its plugins enable, not what this turn
// needs — "translate this sentence" still ships the search, fetch, memory and
// media schemas. With Jev on, each tool is asked about in one parallel call and
// only the clearly irrelevant ones are dropped: a missing tool costs answer
// quality, a spare one only costs input tokens, so the bar is lopsided.
//
// ponytail: per-tool booleans, capped at MAX_TOOLS_ASKED; group by plugin if
// accounts start enabling hundreds of MCP tools.

const DROP_BELOW = 0.1;
const MAX_TOOLS_ASKED = 64;
const SELECTION_TIMEOUT_MS = 1_500;

interface ToolDefinition {
  function?: { name?: unknown; description?: unknown };
}

function lastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { role?: unknown; content?: unknown };
    if (message?.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .map((part) => (typeof (part as { text?: unknown })?.text === "string" ? (part as { text: string }).text : ""))
        .join("\n");
    }
    return "";
  }
  return "";
}

/** Returns the body with irrelevant tools removed, or the same body untouched. */
export async function selectToolsForTurn(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tools = Array.isArray(body.tools) ? (body.tools as ToolDefinition[]) : [];
  // A forced tool_choice names a tool the caller wants; never second-guess it.
  const forced = body.tool_choice !== undefined && body.tool_choice !== "auto";
  if (tools.length < 2 || tools.length > MAX_TOOLS_ASKED || forced) return body;

  const request = lastUserText(body.messages);
  if (!request.trim()) return body;
  if (!(await isJevFeatureEnabled("pluginSelection"))) return body;

  const questions: Record<string, JevQuestion> = {};
  tools.forEach((tool, index) => {
    const name = String(tool.function?.name ?? "");
    const description = typeof tool.function?.description === "string" ? tool.function.description.slice(0, 500) : "";
    questions[`t${index}`] = {
      type: "boolean",
      instructions: `Could answering this request plausibly use the tool "${name}"? ${description}`,
    };
  });

  const answers = await evaluateJev({ request }, questions, SELECTION_TIMEOUT_MS);
  if (!answers) return body;

  const kept = tools.filter((_tool, index) => {
    const answer = answers[`t${index}`];
    return answer?.type !== "boolean" || answer.probability >= DROP_BELOW;
  });
  if (kept.length === tools.length) return body;
  if (kept.length > 0) return { ...body, tools: kept };
  // No tools at all: drop the key and its companion, since some providers
  // reject an empty `tools` array or a tool_choice with nothing to choose.
  const { tools: _tools, tool_choice: _choice, ...rest } = body;
  return rest;
}

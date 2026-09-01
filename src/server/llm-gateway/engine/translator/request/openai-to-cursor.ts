/**
 * OpenAI to Cursor Request Translator
 * Converts OpenAI messages to Cursor ask/agent format.
 *
 * Important: Cursor can loop when tool outputs are sent via protobuf tool_results
 * with partial schema mismatches. For stability, tool outputs are represented as
 * structured text blocks in user messages.
 */
import { register } from "../registry";
import { FORMATS } from "../formats";
import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK } from "../schema/index";
import { DEFAULT_MIN_TOKENS } from "../../config/runtimeConfig";

interface OpenAIMessage {
  role: string;
  content?: string | Record<string, unknown>[];
  tool_calls?: Record<string, unknown>[];
  tool_call_id?: string;
  name?: string;
  is_error?: boolean;
  status?: string;
}

interface CursorMessage {
  role: string;
  content: string;
  tool_calls?: Record<string, unknown>[];
}

function extractContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part: unknown) => {
        if (!part || typeof part !== "object") return false;
        return (part as Record<string, unknown>).type === OPENAI_BLOCK.TEXT && typeof (part as Record<string, unknown>).text === "string";
      })
      .map((part: unknown) => ((part as Record<string, unknown>).text as string) || "")
      .join("");
  }
  return "";
}

function sanitizeToolResultText(text: string): string {
  // Strip non-printable control chars that can produce backend request errors
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildToolResultBlock(toolName: string, toolCallId: string, resultText: string): string {
  const cleanResult = sanitizeToolResultText(resultText || "");
  return [
    "<tool_result>",
    `<tool_name>${escapeXml(toolName || "tool")}</tool_name>`,
    `<tool_call_id>${escapeXml(toolCallId || "")}</tool_call_id>`,
    `<result>${escapeXml(cleanResult)}</result>`,
    "</tool_result>"
  ].join("\n");
}

function normalizeToolCallId(id: unknown): string {
  return typeof id === "string" ? id.split("\n")[0] : "";
}

function convertMessages(messages: OpenAIMessage[]): CursorMessage[] {
  const result: CursorMessage[] = [];
  
  // Build a map of tool_call_id -> tool name from assistant tool calls
  const toolCallMetaMap = new Map<string, { name: string }>();
  const rememberToolMeta = (toolCallId: string, toolName: string) => {
    if (!toolCallId) return;
    const name = toolName || "tool";
    toolCallMetaMap.set(toolCallId, { name });
    const normalized = normalizeToolCallId(toolCallId);
    if (normalized && normalized !== toolCallId) {
      toolCallMetaMap.set(normalized, { name });
    }
  };

  for (const msg of messages) {
    if (msg.role === ROLE.ASSISTANT && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        const fn = tc.function as Record<string, unknown> | undefined;
        rememberToolMeta((tc.id as string) || "", (fn?.name as string) || "tool");
      }
    }
    if (msg.role === ROLE.ASSISTANT && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part?.type !== CLAUDE_BLOCK.TOOL_USE) continue;
        rememberToolMeta((part.id as string) || "", (part.name as string) || "tool");
      }
    }
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === ROLE.SYSTEM) {
      result.push({
        role: ROLE.USER,
        content: `[System Instructions]\n${extractContent(msg.content)}`
      });
      continue;
    }

    if (msg.role === ROLE.TOOL) {
      const toolContent = extractContent(msg.content);
      const toolCallId = msg.tool_call_id || "";
      const toolMeta = toolCallMetaMap.get(toolCallId);
      const toolName = msg.name || toolMeta?.name || "tool";
      result.push({
        role: ROLE.USER,
        content: buildToolResultBlock(toolName, toolCallId, toolContent)
      });
      continue;
    }

    if (msg.role === ROLE.USER || msg.role === ROLE.ASSISTANT) {
      if (msg.role === ROLE.USER && Array.isArray(msg.content)) {
        const parts: string[] = [];
        for (const block of msg.content) {
          if (!block || typeof block !== "object") continue;
          if (block.type === CLAUDE_BLOCK.TEXT) {
            if (typeof block.text === "string") {
              parts.push(block.text || "");
            }
            continue;
          }
          if (block.type === CLAUDE_BLOCK.TOOL_RESULT) {
            const toolCallId = (block.tool_use_id as string) || "";
            const toolMeta =
              toolCallMetaMap.get(toolCallId) ||
              toolCallMetaMap.get(normalizeToolCallId(toolCallId));
            const toolName = toolMeta?.name || "tool";
            const toolContent = extractContent(block.content);
            parts.push(buildToolResultBlock(toolName, toolCallId, toolContent));
          }
        }
        const joined = parts.filter(Boolean).join("\n");
        if (joined) result.push({ role: ROLE.USER, content: joined });
        continue;
      }

      const content = extractContent(msg.content);

      if (msg.role === ROLE.ASSISTANT && msg.tool_calls && msg.tool_calls.length > 0) {
        const assistantMsg: CursorMessage = { role: ROLE.ASSISTANT, content: content || "" };
        assistantMsg.tool_calls = msg.tool_calls.map((tc: Record<string, unknown>) => {
          const { index, ...rest } = tc || {};
          return rest;
        });
        result.push(assistantMsg);
      } else if (msg.role === ROLE.ASSISTANT && Array.isArray(msg.content)) {
        const extractedToolCalls = msg.content
          .filter((b: Record<string, unknown>) => b?.type === CLAUDE_BLOCK.TOOL_USE)
          .map((b: Record<string, unknown>) => ({
            id: (b.id as string) || "",
            type: OPENAI_BLOCK.FUNCTION,
            function: {
              name: (b.name as string) || "tool",
              arguments: JSON.stringify(b.input || {})
            }
          }))
          .filter((tc: Record<string, unknown>) => tc.id);

        if (extractedToolCalls.length > 0) {
          result.push({
            role: ROLE.ASSISTANT,
            content: content || "",
            tool_calls: extractedToolCalls
          });
        } else if (content) {
          result.push({ role: ROLE.ASSISTANT, content });
        }
      } else {
        if (content) {
          result.push({ role: msg.role, content });
        }
      }
    }
  }

  return result;
}

function openaiToCursorRequest(model: string, body: Record<string, unknown>, _stream: boolean, _credentials?: unknown) {
  const messages = convertMessages((body.messages as OpenAIMessage[]) || []);

  // Strip fields irrelevant to Cursor (OpenAI/Anthropic-specific)
  const { user, metadata, tool_choice, stream_options, system, ...rest } = body;

  return {
    ...rest,
    messages,
    max_tokens: DEFAULT_MIN_TOKENS
  };
}

register(FORMATS.OPENAI, FORMATS.CURSOR, openaiToCursorRequest, null);

/**
 * OpenAI → CommandCode request translator
 *
 * Upstream `/alpha/generate` schema (verified live with curl 2026-05-07):
 *  - params.system: STRING at top level (Anthropic-style; system messages NOT allowed in messages[])
 *  - params.messages[*].role ∈ {"user","assistant","tool"}
 *  - params.messages[*].content: Array of content blocks (NEVER a string)
 *  - tool_use blocks (assistant): {type:"tool-call", toolCallId, toolName, input}
 *  - tool_result blocks (role=user): {type:"tool-result", toolCallId, toolName, output}
 *  - tools[*]: Anthropic plain {name, description, input_schema}
 */
import { register } from "../index";
import { FORMATS } from "../formats";
import { randomUUID } from "crypto";
import { ROLE, OPENAI_BLOCK } from "../schema/index";
import { DEFAULT_MAX_TOKENS } from "../../config/runtimeConfig";

function flattenText(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const p of content) {
      if (typeof p === "string") parts.push(p);
      else if (p && typeof p === "object" && typeof (p as Record<string, unknown>).text === "string") parts.push((p as Record<string, unknown>).text as string);
    }
    return parts.join("\n");
  }
  return String(content);
}

function toContentBlocks(content: unknown): Record<string, unknown>[] {
  if (content == null) return [{ type: OPENAI_BLOCK.TEXT, text: "" }];
  if (typeof content === "string") return [{ type: OPENAI_BLOCK.TEXT, text: content }];
  if (Array.isArray(content)) {
    const blocks: Record<string, unknown>[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        blocks.push({ type: OPENAI_BLOCK.TEXT, text: part });
      } else if (part && typeof part === "object") {
        const p = part as Record<string, unknown>;
        if (p.type === OPENAI_BLOCK.TEXT && typeof p.text === "string") {
          blocks.push({ type: OPENAI_BLOCK.TEXT, text: p.text });
        } else if (p.type === OPENAI_BLOCK.IMAGE_URL || p.type === OPENAI_BLOCK.IMAGE) {
          blocks.push({ type: OPENAI_BLOCK.TEXT, text: "[image omitted]" });
        } else if (typeof p.text === "string") {
          blocks.push({ type: OPENAI_BLOCK.TEXT, text: p.text });
        }
      }
    }
    return blocks.length ? blocks : [{ type: OPENAI_BLOCK.TEXT, text: "" }];
  }
  return [{ type: OPENAI_BLOCK.TEXT, text: String(content) }];
}

function safeParseJson(s: unknown): unknown {
  if (s == null) return {};
  if (typeof s !== "string") return s;
  try { return JSON.parse(s); } catch { return {}; }
}

interface OpenAIMessage {
  role?: string;
  content?: unknown;
  tool_calls?: Record<string, unknown>[];
  tool_call_id?: string;
  name?: string;
}

function convertMessages(messages: OpenAIMessage[] = []) {
  const out: Record<string, unknown>[] = [];
  const systemTexts: string[] = [];

  for (const m of messages) {
    if (!m) continue;
    const role = m.role;

    if (role === ROLE.SYSTEM) {
      const t = flattenText(m.content);
      if (t) systemTexts.push(t);
      continue;
    }

    if (role === ROLE.TOOL) {
      const value = typeof m.content === "string" ? m.content : flattenText(m.content);
      out.push({
        role: ROLE.TOOL,
        content: [{
          type: "tool-result",
          toolCallId: m.tool_call_id || "",
          toolName: m.name || "",
          output: { type: "text", value },
        }],
      });
      continue;
    }

    if (role === ROLE.ASSISTANT) {
      const blocks: Record<string, unknown>[] = [];
      const text = flattenText(m.content);
      if (text) blocks.push({ type: OPENAI_BLOCK.TEXT, text });
      if (Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          const fn = (tc.function as Record<string, unknown>) || {};
          blocks.push({
            type: "tool-call",
            toolCallId: (tc.id as string) || "",
            toolName: (fn.name as string) || "",
            input: safeParseJson(fn.arguments),
          });
        }
      }
      out.push({ role: ROLE.ASSISTANT, content: blocks.length ? blocks : [{ type: OPENAI_BLOCK.TEXT, text: "" }] });
      continue;
    }

    out.push({ role: ROLE.USER, content: toContentBlocks(m.content) });
  }

  return { messages: out, system: systemTexts.join("\n\n") };
}

function convertTools(tools: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const result: Record<string, unknown>[] = [];
  for (const t of tools) {
    if (!t) continue;
    const tool = t as Record<string, unknown>;
    if (tool.type === OPENAI_BLOCK.FUNCTION && tool.function) {
      const fn = tool.function as Record<string, unknown>;
      result.push({
        name: fn.name,
        description: fn.description,
        input_schema: fn.parameters || { type: "object" },
      });
    } else if (tool.name && (tool.input_schema || tool.parameters)) {
      result.push({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema || tool.parameters,
      });
    }
  }
  return result.length ? result : undefined;
}

export function openaiToCommandCodeRequest(model: string, body: Record<string, unknown>, stream: boolean /* , credentials */) {
  const { messages, system } = convertMessages(body.messages as OpenAIMessage[]);
  const params: Record<string, unknown> = {
    model,
    messages,
    stream: stream !== false,
    max_tokens: (body.max_tokens as number) ?? (body.max_output_tokens as number) ?? DEFAULT_MAX_TOKENS,
    temperature: (body.temperature as number) ?? 0.3,
  };

  if (system) params.system = system;

  const tools = convertTools(body.tools);
  if (tools) params.tools = tools;
  if (body.top_p != null) params.top_p = body.top_p;

  const today = new Date().toISOString().slice(0, 10);

  return {
    threadId: randomUUID(),
    memory: "",
    config: {
      workingDir: process.cwd(),
      date: today,
      environment: process.platform,
      structure: [],
      isGitRepo: false,
      currentBranch: "",
      mainBranch: "",
      gitStatus: "",
      recentCommits: [],
    },
    params,
  };
}

register(FORMATS.OPENAI, FORMATS.COMMANDCODE, openaiToCommandCodeRequest, null);

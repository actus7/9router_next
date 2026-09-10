import "server-only";

import { handleChat } from "@/server/llm-gateway/chat";
import {
  SERVER_EXECUTABLE_TOOLS,
  executeServerToolCall,
  type ServerToolCall,
  type ServerToolContext,
} from "./serverToolCall";

/**
 * The tool-call loop, running in the worker instead of the browser.
 *
 * This was the last thing a closed tab still stopped. Each step was already
 * durable, but the loop between steps lived in `runToolCallLoop`, so a turn
 * that needed a second tool step waited for a browser that might never come
 * back.
 *
 * Two rules keep the two loops from ever both running a call:
 *
 *   - a step is all-or-nothing. If any call in it needs the browser, none of
 *     them run here and the whole set is handed back on the settled row, which
 *     is where `executeDurableChat` reads tool calls from.
 *   - a hand-back only happens before this side has run anything. Once it has,
 *     the earlier tool results exist only here, so a browser continuing the
 *     chain would send a history missing them; the turn ends here instead and
 *     is reported as unfinished.
 *
 * Continuations are non-streaming on purpose: progress is written once per
 * step rather than once per token, which is all a watcher needs between tool
 * calls and is one less failure mode than a second streaming reader.
 */

/** Same ceiling as the browser loop, for the same reason. */
const MAX_TOOL_STEPS = 8;

export interface ServerToolLoopResult {
  text: string;
  /** Calls this side did not run, for a browser to pick up. */
  leftoverToolCalls: ServerToolCall[];
  reasoning: string;
  usage: Record<string, unknown> | null;
  /** True when the loop ran out of steps with the model still asking. */
  exhausted: boolean;
  /** How many tool calls this side executed, for the run journal. */
  executed: number;
}

function canRunServerSide(name: string, context: ServerToolContext): boolean {
  return context.mcpRuntimeNames.has(name) || SERVER_EXECUTABLE_TOOLS.has(name);
}

/**
 * The tools the browser offered the model, which is exactly the set the session
 * enabled — no separate lookup, and no risk of the two disagreeing.
 */
export function toolNamesFromBody(body: Record<string, unknown>): Set<string> {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const names = new Set<string>();
  for (const tool of tools) {
    const name = (tool as { function?: { name?: unknown } })?.function?.name;
    if (typeof name === "string" && name) names.add(name);
  }
  return names;
}

export interface RunServerToolLoopInput {
  body: Record<string, unknown>;
  authorization: string | null;
  sessionId: string;
  model: string | null;
  firstTurnText: string;
  firstTurnToolCalls: readonly ServerToolCall[];
  /** Called with the accumulated text after each step, to keep watchers fed. */
  onProgress: (text: string) => Promise<boolean>;
  /**
   * Records what the tools did, so the run journal shows server-side work.
   *
   * Without it text simply appears with no sign that anything ran, which is
   * the opposite of what moving the loop here is supposed to buy.
   */
  onToolEvent?: (type: "tool/call" | "tool/result", data: Record<string, unknown>) => Promise<void>;
}

export async function runServerToolLoop(input: RunServerToolLoopInput): Promise<ServerToolLoopResult> {
  const enabledToolNames = toolNamesFromBody(input.body);
  const mcpRuntimeNames = new Set([...enabledToolNames].filter((name) => name.startsWith("mcp_")));
  const context: ServerToolContext = {
    sessionId: input.sessionId,
    authorization: input.authorization,
    enabledToolNames,
    mcpRuntimeNames,
    model: input.model,
  };

  const messages = Array.isArray(input.body.messages) ? [...(input.body.messages as unknown[])] : [];
  let text = input.firstTurnText;
  let reasoning = "";
  let usage: Record<string, unknown> | null = null;
  let pending: ServerToolCall[] = [...input.firstTurnToolCalls];
  let executed = 0;

  for (let step = 0; step < MAX_TOOL_STEPS && pending.length > 0; step += 1) {
    if (!pending.every((call) => canRunServerSide(call.name, context))) {
      // Handing calls back is only safe before this side has run any: the tool
      // results of earlier steps live in this function's `messages`, not in the
      // client's conversation, so a browser continuing from step three would
      // send a history missing steps one and two and the model would answer
      // without them. Once a step has run here, the turn ends here instead.
      if (executed === 0) {
        return { text, leftoverToolCalls: pending, reasoning, usage, exhausted: false, executed };
      }
      return { text, leftoverToolCalls: [], reasoning, usage, exhausted: true, executed };
    }

    messages.push({
      role: "assistant",
      content: text || null,
      tool_calls: pending.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      })),
    });

    for (const call of pending) {
      await input.onToolEvent?.("tool/call", {
        toolCallId: call.id,
        name: call.name,
        arguments: call.arguments,
        ranOn: "server",
      });
      const result = await executeServerToolCall(call, context).catch((error: unknown) =>
        JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Tool execution failed" }),
      );
      await input.onToolEvent?.("tool/result", {
        toolCallId: call.id,
        name: call.name,
        content: result ?? "",
        ranOn: "server",
      });
      // `canRunServerSide` was already checked, so null here would be a bug in
      // that agreement rather than a browser-only tool. Reported, not skipped.
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result ?? JSON.stringify({ ok: false, error: `No server-side executor for ${call.name}` }),
      });
      executed += 1;
    }

    const response = await handleChat(
      new Request("http://durable-run.local/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(input.authorization ? { Authorization: input.authorization } : {}),
        },
        body: JSON.stringify({ ...input.body, messages, stream: false }),
      }),
    );
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const error = detail.error ?? detail.message;
      throw new Error(
        typeof error === "string" ? error : `Continuation failed (${response.status})`,
      );
    }

    const payload = (await response.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown; reasoning?: unknown } }>;
      usage?: Record<string, unknown>;
    };
    const message = payload.choices?.[0]?.message;
    const turnText = typeof message?.content === "string" ? message.content : "";
    if (turnText) text = text ? `${text}\n\n${turnText}` : turnText;
    if (typeof message?.reasoning === "string" && message.reasoning) reasoning = message.reasoning;
    if (payload.usage) usage = payload.usage;

    // A stop lands here as a progress write that matches no row.
    if (!(await input.onProgress(text))) {
      return { text, leftoverToolCalls: [], reasoning, usage, exhausted: false, executed };
    }

    pending = Array.isArray(message?.tool_calls)
      ? (message.tool_calls as Array<Record<string, unknown>>)
          .map((call) => ({
            id: typeof call.id === "string" ? call.id : "",
            name: String((call.function as { name?: unknown } | undefined)?.name ?? ""),
            arguments: String((call.function as { arguments?: unknown } | undefined)?.arguments ?? "{}"),
          }))
          .filter((call) => call.id && call.name)
      : [];
  }

  return { text, leftoverToolCalls: pending, reasoning, usage, exhausted: pending.length > 0, executed };
}

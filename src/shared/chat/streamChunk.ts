/**
 * Reading one OpenAI-compatible stream chunk.
 *
 * Lives in `shared` because both sides of a durable run parse the same bytes:
 * the browser while it watches a run live, and the server worker that keeps
 * writing after the browser is gone. Two copies of these would drift, and the
 * drift would show up as text that renders in one place and not the other.
 */

export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cached_tokens?: number;
}

export interface StreamToolCall {
  id: string;
  name: string;
  arguments: string;
}

export function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(" ");
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.error === "string") return obj.error;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function readAssistantText(chunk: Record<string, unknown>): string {
  if (!chunk || typeof chunk !== "object") return "";
  const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
  const choice = choices?.[0];
  const delta = (choice?.delta as Record<string, unknown>) || {};
  const messageObj = choice?.message as Record<string, unknown> | undefined;
  const pieces = [delta.content, messageObj?.content, chunk.output_text, chunk.text]
    .map(textValue)
    .filter(Boolean);
  return pieces[0] || "";
}

/** Reasoning/thinking delta text, when the provider streams it alongside content. */
export function readReasoningText(chunk: Record<string, unknown>): string {
  if (!chunk || typeof chunk !== "object") return "";
  const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
  const delta = (choices?.[0]?.delta as Record<string, unknown>) || {};
  const pieces = [delta.reasoning_content, delta.reasoning, delta.thinking]
    .map(textValue)
    .filter(Boolean);
  return pieces[0] || "";
}

/** Final-chunk token usage, when the provider reports it. */
export function readStreamUsage(chunk: Record<string, unknown>): TokenUsage | null {
  const usage = chunk?.usage as Record<string, unknown> | undefined;
  if (!usage || typeof usage !== "object") return null;
  const promptDetails = usage.prompt_tokens_details as Record<string, unknown> | undefined;
  const cachedTokens = Number(promptDetails?.cached_tokens ?? usage.cache_read_input_tokens ?? 0) || 0;
  return {
    prompt_tokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0,
    completion_tokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0,
    total_tokens: Number(usage.total_tokens ?? 0) || undefined,
    ...(cachedTokens > 0 ? { cached_tokens: cachedTokens } : {}),
  };
}

type PartialStreamToolCall = {
  id?: unknown;
  index?: unknown;
  function?: { name?: unknown; arguments?: unknown };
};

/** Merge OpenAI-compatible incremental tool-call chunks into complete calls. */
export function collectToolCallDeltas(calls: Map<number, StreamToolCall>, deltas: unknown): void {
  if (!Array.isArray(deltas)) return;
  for (const delta of deltas as PartialStreamToolCall[]) {
    const index = typeof delta.index === "number" ? delta.index : 0;
    const previous = calls.get(index) || { id: "", name: "", arguments: "" };
    calls.set(index, {
      id: typeof delta.id === "string" ? delta.id : previous.id,
      name: typeof delta.function?.name === "string" ? delta.function.name : previous.name,
      arguments: previous.arguments + (typeof delta.function?.arguments === "string" ? delta.function.arguments : ""),
    });
  }
}

export interface ParsedStream {
  text: string;
  reasoning: string;
  toolCalls: StreamToolCall[];
  usage: TokenUsage | null;
}

/**
 * Feeds SSE bytes in and accumulates the answer.
 *
 * Stateful on purpose: a chunk boundary can land mid-line, and both callers
 * read from a stream they cannot rewind.
 */
export class StreamChunkAccumulator {
  private buffer = "";
  private assistantText = "";
  private reasoningText = "";
  private usage: TokenUsage | null = null;
  private readonly toolCalls = new Map<number, StreamToolCall>();

  /** Returns true when this batch added visible text. */
  push(bytes: string): boolean {
    this.buffer += bytes;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || "";
    let grew = false;
    for (const line of lines) grew = this.consumeLine(line) || grew;
    return grew;
  }

  /**
   * Processes whatever is left once the stream closes.
   *
   * Some providers close right after the final data frame instead of
   * terminating it with a newline; without this the last frame is dropped and
   * the answer is silently truncated.
   */
  finish(trailing = ""): ParsedStream {
    this.buffer += trailing;
    if (this.buffer.trim()) this.consumeLine(this.buffer);
    this.buffer = "";
    return this.result();
  }

  result(): ParsedStream {
    return {
      text: this.assistantText,
      reasoning: this.reasoningText,
      toolCalls: Array.from(this.toolCalls.values()).filter((call) => call.id && call.name),
      usage: this.usage,
    };
  }

  private consumeLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return false;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return false;
    try {
      const chunk = JSON.parse(payload) as Record<string, unknown>;
      const delta = ((chunk?.choices as Array<Record<string, unknown>> | undefined)?.[0]?.delta || {}) as Record<string, unknown>;
      collectToolCallDeltas(this.toolCalls, delta.tool_calls);
      this.usage = readStreamUsage(chunk) || this.usage;
      this.reasoningText += readReasoningText(chunk);
      const text = readAssistantText(chunk);
      if (!text) return false;
      this.assistantText += text;
      return true;
    } catch {
      // Ignore malformed chunks.
      return false;
    }
  }
}

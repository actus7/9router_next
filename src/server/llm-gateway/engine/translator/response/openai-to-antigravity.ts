import { register } from "../index";
import { FORMATS } from "../formats";
import { GEMINI_ROLE, OPENAI_FINISH, GEMINI_FINISH } from "../schema/index";

// Convert OpenAI SSE chunk to Antigravity SSE format
// Real Antigravity format:
//   data: {"response":{"candidates":[{"content":{"role":"model","parts":[...]}, "finishReason":"STOP"}], "usageMetadata":{...}, "modelVersion":"...", "responseId":"..."}}
// Tool calls: OpenAI sends incremental args across chunks → accumulate and emit ONCE at finish
export function openaiToAntigravityResponse(chunk: Record<string, unknown>, state: Record<string, unknown>) {
  if (!chunk) return null;

  const choices = chunk.choices as Record<string, unknown>[] | undefined;
  const choice = choices?.[0];
  if (!choice) {
    if (chunk.usage) {
      state._usage = chunk.usage;
    }
    return null;
  }

  const delta = (choice.delta as Record<string, unknown>) || {};
  const finishReason = choice.finish_reason as string | null | undefined;

  // Init state
  if (!state._toolCallAccum) state._toolCallAccum = {};
  if (!state._responseId) state._responseId = (chunk.id as string) || `resp_${Date.now()}`;
  if (!state._modelVersion) state._modelVersion = (chunk.model as string) || "";

  const parts: Record<string, unknown>[] = [];

  // Thinking/reasoning → thought part
  if (delta.reasoning_content) {
    parts.push({ thought: true, text: delta.reasoning_content });
  }

  // Text content
  if (delta.content) {
    parts.push({ text: delta.content });
  }

  // Accumulate tool calls silently (no emit until finish)
  if (delta.tool_calls) {
    const toolCallAccum = state._toolCallAccum as Record<string, Record<string, unknown>>;
    for (const tc of delta.tool_calls as Record<string, unknown>[]) {
      const idx = (tc.index as number) ?? 0;
      if (!toolCallAccum[idx]) {
        toolCallAccum[idx] = { id: "", name: "", arguments: "" };
      }
      const accum = toolCallAccum[idx];
      if (tc.id) accum.id = tc.id;
      const fn = tc.function as Record<string, unknown> | undefined;
      if (fn?.name) accum.name = (accum.name as string) + (fn.name as string);
      if (fn?.arguments) accum.arguments = (accum.arguments as string) + (fn.arguments as string);
    }
    // Skip emit — wait for finish_reason
    if (parts.length === 0 && !finishReason) return null;
  }

  // On finish, emit accumulated tool calls as complete functionCall parts
  if (finishReason) {
    const toolCallAccum = state._toolCallAccum as Record<string, Record<string, unknown>>;
    const indices = Object.keys(toolCallAccum);
    for (const idx of indices) {
      const accum = toolCallAccum[idx];
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(accum.arguments as string); } catch { /* empty */ }
      // Restore original tool name if it was prefixed during cloaking
      const toolNameMap = state.toolNameMap as Map<string, string> | undefined;
      const originalName = toolNameMap?.get(accum.name as string) || accum.name;
      parts.push({
        functionCall: {
          name: originalName,
          args
        }
      });
    }
  }

  // Skip empty non-finish chunks
  if (parts.length === 0 && !finishReason) return null;

  // Ensure at least empty text part on finish with no content
  if (parts.length === 0 && finishReason) {
    parts.push({ text: "" });
  }

  // Build candidate
  const candidate: Record<string, unknown> = { content: { role: GEMINI_ROLE.MODEL, parts } };

  // Finish reason mapping
  if (finishReason) {
    const reasonMap: Record<string, string> = {
      [OPENAI_FINISH.STOP as string]: GEMINI_FINISH.STOP,
      [OPENAI_FINISH.LENGTH as string]: GEMINI_FINISH.MAX_TOKENS,
      [OPENAI_FINISH.TOOL_CALLS as string]: GEMINI_FINISH.STOP,
      [OPENAI_FINISH.CONTENT_FILTER as string]: GEMINI_FINISH.SAFETY
    };
    candidate.finishReason = reasonMap[finishReason] || GEMINI_FINISH.STOP;
  }

  // Build response
  const response: Record<string, unknown> = {
    candidates: [candidate],
    modelVersion: state._modelVersion,
    responseId: state._responseId
  };

  // Usage metadata
  const usage = (chunk.usage || state._usage) as Record<string, unknown> | undefined;
  if (usage) {
    const usageMetadata: Record<string, unknown> = {
      promptTokenCount: (usage.prompt_tokens as number) || 0,
      candidatesTokenCount: (usage.completion_tokens as number) || 0,
      totalTokenCount: (usage.total_tokens as number) || 0
    };
    const compDetails = usage.completion_tokens_details as Record<string, unknown> | undefined;
    if (compDetails?.reasoning_tokens) {
      usageMetadata.thoughtsTokenCount = compDetails.reasoning_tokens;
    }
    const promptDetails = usage.prompt_tokens_details as Record<string, unknown> | undefined;
    if (promptDetails?.cached_tokens) {
      usageMetadata.cachedContentTokenCount = promptDetails.cached_tokens;
    }
    response.usageMetadata = usageMetadata;
  }

  return { response };
}

// Register
register(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, null, openaiToAntigravityResponse as (chunk: unknown, state: unknown) => unknown);

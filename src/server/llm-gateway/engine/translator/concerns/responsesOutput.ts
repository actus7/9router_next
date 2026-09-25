// Chat Completions → Responses API: shared output[] bookkeeping and usage shape.

export function toResponsesUsage(u: Record<string, unknown>) {
  const input = typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0;
  const output = typeof u.completion_tokens === "number" ? u.completion_tokens : 0;
  const cached = (u.prompt_tokens_details as Record<string, unknown> | undefined)?.cached_tokens;
  const reasoning = (u.completion_tokens_details as Record<string, unknown> | undefined)?.reasoning_tokens;
  return {
    input_tokens: input,
    input_tokens_details: { cached_tokens: typeof cached === "number" ? cached : 0 },
    output_tokens: output,
    output_tokens_details: { reasoning_tokens: typeof reasoning === "number" ? reasoning : 0 },
    total_tokens: typeof u.total_tokens === "number" ? u.total_tokens : input + output,
  };
}

// Items share one output[] in the Responses API; the SDK's accumulator indexes
// it by output_index. Reusing the chat choice/tool index put a message and a
// function_call both at 0.
export function outIndex(state: Record<string, unknown>, key: string): number {
  const map = (state.outIndexes ||= {}) as Record<string, number>;
  if (map[key] === undefined) {
    map[key] = (state.nextOutIndex as number) || 0;
    state.nextOutIndex = map[key] + 1;
  }
  return map[key];
}

export function recordDoneItem(state: Record<string, unknown>, outputIndex: number, item: Record<string, unknown>) {
  ((state.doneItems ||= []) as Array<{ i: number; item: Record<string, unknown> }>).push({ i: outputIndex, item });
}

export function completedOutput(state: Record<string, unknown>) {
  return [...((state.doneItems || []) as Array<{ i: number; item: Record<string, unknown> }>)]
    .sort((a, b) => a.i - b.i)
    .map((d) => d.item);
}

export function sseChunk(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// Build OpenAI chat.completion.chunk SSE frame. Key order: id, object, created, model, choices.
export function chatChunkSse({ id, created, model, delta, finishReason = null }: { id: string; created: number; model: string; delta: Record<string, unknown>; finishReason?: string | null }) {
  return sseChunk({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  });
}

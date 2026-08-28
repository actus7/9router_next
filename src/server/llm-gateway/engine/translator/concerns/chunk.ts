// Build OpenAI chat.completion.chunk. Caller supplies id/created/model so each
// translator keeps its exact id-generation + created semantics (no Date.now here).
import type { ChunkMeta } from "./openaiTypes";

export function buildChunk({ id, created, model }: ChunkMeta, delta: Record<string, unknown>, finishReason: string | null = null) {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

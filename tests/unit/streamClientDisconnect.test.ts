import { describe, expect, it, vi } from "vitest";

/**
 * Um cliente OpenAI-compatível para de ler no primeiro `data: [DONE]` e fecha a
 * conexão. Quando isso acontece o `flush()` do TransformStream nunca roda — e
 * era só de lá que saíam `onStreamComplete` (que grava em `usageHistory`) e a
 * baixa do contador de requisições em voo. Resultado: a requisição respondia
 * certo, não aparecia em lugar nenhum do dashboard, e o provedor ficava
 * "ocupado" na topologia até o timeout de pendência.
 *
 * Reproduzido ao vivo contra o gateway em 2026-09-14: mesmo prompt, drenando o
 * stream até o fim gravava a linha; parando no `[DONE]` não gravava nada.
 */
vi.mock("@/server/llm-gateway/engine/host/usage", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => undefined),
  saveRequestDetail: vi.fn(async () => undefined),
  saveRequestUsage: vi.fn(async () => undefined),
}));

const { createPassthroughStreamWithLogger } = await import("@/server/llm-gateway/engine/utils/stream");
const { trackPendingRequest } = await import("@/server/llm-gateway/engine/host/usage");

const UPSTREAM = [
  `data: {"choices":[{"delta":{"content":"ok"}}]}\n\n`,
  `data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":2,"total_tokens":13}}\n\n`,
  `data: [DONE]\n\n`,
].join("");

/** Escreve o stream do provedor e desiste na primeira leitura que contenha `[DONE]`. */
async function readUntilDone(transform: TransformStream<Uint8Array, Uint8Array>): Promise<void> {
  const writer = transform.writable.getWriter();
  const reader = transform.readable.getReader();
  const decoder = new TextDecoder();
  writer.write(new TextEncoder().encode(UPSTREAM)).catch(() => {});

  let seen = "";
  while (!seen.includes("[DONE]")) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += decoder.decode(value, { stream: true });
  }
  await reader.cancel("client closed");
}

describe("SSE stream settled by a client that closes on [DONE]", () => {
  it("still reports the usage it collected", async () => {
    const onStreamComplete = vi.fn();
    const transform = createPassthroughStreamWithLogger(
      "opencode", null, "big-pickle", "conn-1", {}, onStreamComplete, null,
    ) as TransformStream<Uint8Array, Uint8Array>;

    await readUntilDone(transform);

    expect(onStreamComplete).toHaveBeenCalledTimes(1);
    const [, usage] = onStreamComplete.mock.calls[0];
    expect(usage).toMatchObject({ prompt_tokens: 11, completion_tokens: 2 });
  });

  it("clears the in-flight request instead of leaving it pending", async () => {
    vi.mocked(trackPendingRequest).mockClear();
    const transform = createPassthroughStreamWithLogger(
      "opencode", null, "big-pickle", "conn-1", {}, vi.fn(), null,
    ) as TransformStream<Uint8Array, Uint8Array>;

    await readUntilDone(transform);

    expect(trackPendingRequest).toHaveBeenCalledWith("big-pickle", "opencode", "conn-1", false);
  });
});

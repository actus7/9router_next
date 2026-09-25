import { describe, expect, it } from "vitest";
import { pipeWithDisconnect, createStreamController } from "@/server/llm-gateway/engine/utils/streamHandler";
import { abortTerminalFor } from "@/server/llm-gateway/engine/utils/responsesStreamHelpers";

// Upstream que para de mandar bytes no meio da resposta: o watchdog aborta, e
// o cliente tem de receber um erro no protocolo dele — não um stream que só
// termina e parece completo.

// Como um fetch real: o body falha quando o sinal da requisição aborta.
function stalledUpstream(first: string, signal: AbortSignal): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(first));
      signal.addEventListener("abort", () => {
        const e = new Error("This operation was aborted");
        e.name = "AbortError";
        c.error(e);
      });
    },
  });
  return new Response(body);
}

async function drain(format: string) {
  const ctrl = createStreamController({});
  const stream = pipeWithDisconnect(
    stalledUpstream("data: partial\n\n", ctrl.signal),
    new TransformStream<Uint8Array, Uint8Array>(),
    ctrl,
    abortTerminalFor(format),
    30,
    30,
  );
  return new Response(stream).text();
}

describe("stream interrompido pelo upstream", () => {
  it("cliente OpenAI recebe um chunk de erro e [DONE]", async () => {
    const text = await drain("openai");
    expect(text).toContain('"error"');
    expect(text).toContain("stream_interrupted");
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
  });

  it("cliente Anthropic recebe event: error", async () => {
    const text = await drain("claude");
    expect(text).toMatch(/event: error\ndata: \{"type":"error"/);
  });
});

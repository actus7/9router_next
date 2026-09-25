import { describe, it, expect } from "vitest";
import { createNonStreamingResponse, createStreamingResponse } from "@/server/llm-gateway/engine/utils/localResponse";

// Respostas locais (Synapse e bypass) têm de ser indistinguíveis de uma
// resposta real do protocolo que o cliente fala — os SDKs oficiais parseiam
// cada linha e quebram com qualquer desvio.

const dataLines = (sse: string) =>
  sse.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());

describe("localResponse — OpenAI", () => {
  it("stream não emite `data: null` e termina com [DONE]", async () => {
    const lines = dataLines(await createStreamingResponse("openai", "m", "Olá!").response.text());
    expect(lines.at(-1)).toBe("[DONE]");
    for (const l of lines.slice(0, -1)) {
      const chunk = JSON.parse(l);
      expect(chunk?.object).toBe("chat.completion.chunk");
    }
  });
});

describe("localResponse — Anthropic", () => {
  it("não-stream traz o texto e stop_reason end_turn", async () => {
    const msg = await createNonStreamingResponse("claude", "m", "Olá!").response.json();
    expect(msg.type).toBe("message");
    expect(msg.id).toMatch(/^msg_/);
    expect(msg.content).toEqual([{ type: "text", text: "Olá!" }]);
    expect(msg.stop_reason).toBe("end_turn");
    expect(msg.usage.output_tokens).toBeGreaterThan(0);
  });

  it("stream termina em message_stop, sem o sentinela [DONE] da OpenAI", async () => {
    const lines = dataLines(await createStreamingResponse("claude", "m", "Olá!").response.text());
    expect(lines).not.toContain("[DONE]");
    expect(JSON.parse(lines.at(-1)!).type).toBe("message_stop");
  });
});

describe("localResponse — Responses API", () => {
  it("não-stream devolve o objeto response com output, não o envelope SSE", async () => {
    const res = await createNonStreamingResponse("openai-responses", "m", "Olá!").response.json();
    expect(res.object).toBe("response");
    expect(res.status).toBe("completed");
    expect(res.output[0].type).toBe("message");
    expect(res.output[0].content[0]).toMatchObject({ type: "output_text", text: "Olá!" });
    expect(res.usage.total_tokens).toBeGreaterThan(0);
  });
});

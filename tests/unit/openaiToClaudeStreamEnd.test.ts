import { describe, it, expect } from "vitest";
import { translateResponse, initState } from "@/server/llm-gateway/engine/translator/index";
import { FORMATS } from "@/server/llm-gateway/engine/translator/formats";

// Cliente Anthropic (Claude Code, @anthropic-ai/sdk) com upstream OpenAI: o SDK
// só dá a mensagem por encerrada em `message_stop`, e só vê erro em `event: error`.

function run(chunks: Array<Record<string, unknown> | null>) {
  const state = initState(FORMATS.CLAUDE) as Record<string, unknown>;
  const out: Array<Record<string, unknown>> = [];
  for (const c of chunks) {
    const r = translateResponse(FORMATS.OPENAI, FORMATS.CLAUDE, c, state) as unknown[] | null;
    for (const item of r || []) if (item) out.push(item as Record<string, unknown>);
  }
  return out.map((e) => e.type);
}

const text = (content: string, finish: string | null = null) => ({
  id: "chatcmpl-abcdefgh", model: "m",
  choices: [{ index: 0, delta: { content }, finish_reason: finish }],
});

describe("openai → claude: fim do stream", () => {
  it("stream sem finish_reason ainda fecha o bloco e emite message_stop no flush", () => {
    const types = run([text("Hi"), null]);
    expect(types.slice(-3)).toEqual(["content_block_stop", "message_delta", "message_stop"]);
  });

  it("finish_reason repetido não duplica message_delta/message_stop", () => {
    const types = run([text("Hi", "stop"), text("", "stop"), null]);
    expect(types.filter((t) => t === "message_stop")).toHaveLength(1);
    expect(types.filter((t) => t === "message_delta")).toHaveLength(1);
  });

  it("erro no meio do stream vira `event: error`, sem message_stop falso depois", () => {
    const types = run([text("Hi"), { error: { message: "upstream overloaded" } }, null]);
    expect(types).toContain("error");
    expect(types).not.toContain("message_stop");
  });
});

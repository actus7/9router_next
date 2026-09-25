import { describe, it, expect } from "vitest";
import { translateResponse, initState } from "@/server/llm-gateway/engine/translator/index";
import { FORMATS } from "@/server/llm-gateway/engine/translator/formats";

// Cliente da Responses API (SDK da OpenAI, Codex) com upstream Chat Completions.
// O ResponseStream do SDK indexa `output[]` por `output_index`, e
// `finalResponse()` / o usage do Codex vêm do `response.completed`.

type Ev = { event: string; data: Record<string, unknown> };

function run(chunks: Array<Record<string, unknown> | null>): Ev[] {
  const state = initState(FORMATS.OPENAI_RESPONSES) as Record<string, unknown>;
  const out: Ev[] = [];
  for (const c of chunks) {
    for (const e of (translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, c, state) as Ev[] | null) || []) {
      if (e) out.push(e);
    }
  }
  return out;
}

const chunk = (delta: Record<string, unknown>, finish: string | null = null, extra: Record<string, unknown> = {}) => ({
  id: "chatcmpl-x", model: "m", choices: [{ index: 0, delta, finish_reason: finish }], ...extra,
});

const STREAM = [
  chunk({ role: "assistant", content: "Vou ler." }),
  chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "read", arguments: "{\"p\":1}" } }] }),
  chunk({}, "tool_calls"),
  { id: "chatcmpl-x", model: "m", choices: [], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } },
  null,
];

describe("chat → responses: itens de saída", () => {
  it("mensagem e function_call recebem output_index distintos", () => {
    const added = run(STREAM).filter((e) => e.event === "response.output_item.added");
    const idx = added.map((e) => e.data.output_index);
    expect(new Set(idx).size).toBe(added.length);
  });

  it("response.completed traz output completo e usage", () => {
    const completed = run(STREAM).find((e) => e.event === "response.completed")!;
    const response = completed.data.response as Record<string, unknown>;
    const output = response.output as Array<Record<string, unknown>>;
    expect(output.map((o) => o.type)).toEqual(["message", "function_call"]);
    expect(response.usage).toMatchObject({ input_tokens: 10, output_tokens: 4, total_tokens: 14 });
  });

  it("response.completed sai exatamente uma vez", () => {
    expect(run(STREAM).filter((e) => e.event === "response.completed")).toHaveLength(1);
  });
});

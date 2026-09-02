import { describe, it, expect } from "vitest";
import { matchSynapseDeterministic, trySynapseIntercept, normalize } from "@/server/llm-gateway/engine/rtk/synapse";

// ── normalize ──────────────────────────────────────────────────────────────
describe("normalize", () => {
  it("lowercase + strip diacritics + trim", () => {
    expect(normalize("  Olá!  ")).toBe("ola!");
    expect(normalize("OBRIGADO")).toBe("obrigado");
    expect(normalize("  ÁéÍ  ")).toBe("aei");
  });
});

// ── matchSynapseDeterministic ──────────────────────────────────────────────
describe("matchSynapseDeterministic", () => {
  // LITE level
  it("'oi' → intercepta (lite)", () => {
    const result = matchSynapseDeterministic("oi", "lite");
    expect(result).not.toBeNull();
    expect(result).toMatch(/olá|oi|ajud/i);
  });

  it("'ola' → intercepta (lite)", () => {
    const result = matchSynapseDeterministic("ola", "lite");
    expect(result).not.toBeNull();
  });

  it("'bom dia' → intercepta (lite)", () => {
    const result = matchSynapseDeterministic("bom dia", "lite");
    expect(result).not.toBeNull();
  });

  it("'tchau' → intercepta (lite)", () => {
    const result = matchSynapseDeterministic("tchau", "lite");
    expect(result).not.toBeNull();
    expect(result).toMatch(/até|tchau/i);
  });

  it("'obrigado' → intercepta (lite)", () => {
    const result = matchSynapseDeterministic("obrigado", "lite");
    expect(result).not.toBeNull();
    expect(result).toMatch(/de nada|disponha|por nada/i);
  });

  it("'tudo bem?' → intercepta (lite)", () => {
    const result = matchSynapseDeterministic("tudo bem?", "lite");
    expect(result).not.toBeNull();
  });

  it("'ping' → null com level lite (keyword é full)", () => {
    const result = matchSynapseDeterministic("ping", "lite");
    expect(result).toBeNull();
  });

  it("'quem e voce' → null com level lite (keyword é full)", () => {
    const result = matchSynapseDeterministic("quem e voce", "lite");
    expect(result).toBeNull();
  });

  // FULL level
  it("'quem e voce' → intercepta com level full", () => {
    const result = matchSynapseDeterministic("quem e voce", "full");
    expect(result).not.toBeNull();
    expect(result).toMatch(/assistente/i);
  });

  it("'ping' → 'pong' com level full", () => {
    const result = matchSynapseDeterministic("ping", "full");
    expect(result).toBe("Pong");
  });

  it("'ok' → intercepta com level full", () => {
    const result = matchSynapseDeterministic("ok", "full");
    expect(result).not.toBeNull();
  });

  // Não intercepta
  it("'nao funciona o login' → null (sem keyword de erro)", () => {
    const result = matchSynapseDeterministic("nao funciona o login", "full");
    expect(result).toBeNull();
  });

  it("mensagem > 120 chars → null", () => {
    const longMsg = "a".repeat(121);
    const result = matchSynapseDeterministic(longMsg, "lite");
    expect(result).toBeNull();
  });

  it("string vazia → null", () => {
    expect(matchSynapseDeterministic("", "lite")).toBeNull();
    expect(matchSynapseDeterministic("   ", "lite")).toBeNull();
  });

  it("'me ajuda com o codigo' → null (sem keyword de ação)", () => {
    const result = matchSynapseDeterministic("me ajuda com o codigo", "full");
    expect(result).toBeNull();
  });
});

// ── trySynapseIntercept ────────────────────────────────────────────────────
describe("trySynapseIntercept", () => {
  const baseParams = {
    body: { messages: [{ role: "user", content: "oi" }] } as Record<string, unknown>,
    sourceFormat: "openai",
    stream: true,
    model: "gpt-4o",
    provider: "openai",
    enabled: true,
    level: "lite" as string | undefined,
    log: undefined,
    reqTag: "[test]",
  };

  it("enabled=false → null", () => {
    const result = trySynapseIntercept({ ...baseParams, enabled: false });
    expect(result).toBeNull();
  });

  it("'oi' como última user msg, sem tools, openai format, stream=true → intercepta", async () => {
    const result = trySynapseIntercept(baseParams);
    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.response.headers.get("Content-Type")).toBe("text/event-stream");
    const text = await result!.response.text();
    expect(text).toContain("data:");
    expect(text).toContain("[DONE]");
  });

  it("'oi' como última user msg, stream=false → JSON com choices[0].message.content", async () => {
    const result = trySynapseIntercept({ ...baseParams, stream: false });
    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    const json = JSON.parse(await result!.response.text());
    expect(json.choices[0].message.content).toBeDefined();
    expect(json.choices[0].finish_reason).toBe("stop");
  });

  it("última mensagem não é user (assistant) → null", () => {
    const body = { messages: [{ role: "assistant", content: "hello" }] };
    const result = trySynapseIntercept({ ...baseParams, body });
    expect(result).toBeNull();
  });

  it("body.tools não-vazio → null (Claude Code nunca é interceptado)", () => {
    const body = {
      messages: [{ role: "user", content: "oi" }],
      tools: [{ type: "function", function: { name: "test" } }],
    };
    const result = trySynapseIntercept({ ...baseParams, body });
    expect(result).toBeNull();
  });

  it("histórico claude com bloco tool_use → null", () => {
    const body = {
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "bash", input: {} }] },
        { role: "user", content: "oi" },
      ],
    };
    const result = trySynapseIntercept({ ...baseParams, body });
    expect(result).toBeNull();
  });

  it("histórico openai com role 'tool' → null", () => {
    const body = {
      messages: [
        { role: "tool", content: "result" },
        { role: "user", content: "oi" },
      ],
    };
    const result = trySynapseIntercept({ ...baseParams, body });
    expect(result).toBeNull();
  });

  it("input (openai-responses) com function_call_output → null", () => {
    const body = {
      input: [
        { type: "function_call_output", call_id: "c1", output: "ok" },
        { type: "message", role: "user", content: [{ type: "input_text", text: "oi" }] },
      ],
    };
    const result = trySynapseIntercept({ ...baseParams, body, sourceFormat: "openai-responses" });
    expect(result).toBeNull();
  });

  it("contents (gemini) com functionResponse part → null", () => {
    const body = {
      contents: [
        { role: "model", parts: [{ functionResponse: { name: "fn", response: {} } }] },
        { role: "user", parts: [{ text: "oi" }] },
      ],
    };
    const result = trySynapseIntercept({ ...baseParams, body, sourceFormat: "gemini" });
    expect(result).toBeNull();
  });

  it("mensagem > 120 chars → null", () => {
    const body = { messages: [{ role: "user", content: "a".repeat(121) }] };
    const result = trySynapseIntercept({ ...baseParams, body });
    expect(result).toBeNull();
  });

  it("level gating: 'quem e voce' → intercepta com level 'full'; null com level 'lite'", () => {
    const body = { messages: [{ role: "user", content: "quem e voce" }] };
    const fullResult = trySynapseIntercept({ ...baseParams, body, level: "full" });
    expect(fullResult).not.toBeNull();
    const liteResult = trySynapseIntercept({ ...baseParams, body, level: "lite" });
    expect(liteResult).toBeNull();
  });

  it("'ping' com level 'full' → resposta 'pong'", async () => {
    const body = { messages: [{ role: "user", content: "ping" }] };
    const result = trySynapseIntercept({ ...baseParams, body, level: "full", stream: false });
    expect(result).not.toBeNull();
    const json = JSON.parse(await result!.response.text());
    expect(json.choices[0].message.content).toBe("Pong");
  });

  it("'nao funciona o login' → null (nunca intercepta)", () => {
    const body = { messages: [{ role: "user", content: "nao funciona o login" }] };
    const result = trySynapseIntercept({ ...baseParams, body, level: "full" });
    expect(result).toBeNull();
  });

  it("body malformado (messages não-array) → null, sem throw", () => {
    const body = { messages: "not-an-array" } as unknown as Record<string, unknown>;
    expect(() => trySynapseIntercept({ ...baseParams, body })).not.toThrow();
    expect(trySynapseIntercept({ ...baseParams, body })).toBeNull();
  });

  it("modelo imageGen → null", () => {
    const body = { messages: [{ role: "user", content: "oi" }] };
    const result = trySynapseIntercept({ ...baseParams, body, model: "imagen-3" });
    expect(result).toBeNull();
  });

  it("gemini tools com functionDeclarations não-vazio → null", () => {
    const body = {
      messages: [{ role: "user", content: "oi" }],
      tools: [{ functionDeclarations: [{ name: "fn" }] }],
    };
    const result = trySynapseIntercept({ ...baseParams, body });
    expect(result).toBeNull();
  });

  it("body.functions não-vazio → null", () => {
    const body = {
      messages: [{ role: "user", content: "oi" }],
      functions: [{ name: "fn" }],
    };
    const result = trySynapseIntercept({ ...baseParams, body });
    expect(result).toBeNull();
  });

  it("gírias pt-BR: 'vlw' → intercepta (preTransform normaliza para 'valeu')", () => {
    const body = { messages: [{ role: "user", content: "vlw" }] };
    const result = trySynapseIntercept({ ...baseParams, body });
    expect(result).not.toBeNull();
  });

  it("gírias pt-BR: 'blz' como confirmação → intercepta com level full", () => {
    const body = { messages: [{ role: "user", content: "blz" }] };
    const result = trySynapseIntercept({ ...baseParams, body, level: "full" });
    expect(result).not.toBeNull();
  });
});

// ── Match total vs. parcial ─────────────────────────────────────────────────
// O engine é ANCORADO por sentença inteira (^...$): a keyword precisa ser a
// sentença inteira, não uma substring dela. Isso é a garantia central contra
// falso positivo — vale testar explicitamente, não só implicitamente via
// "não intercepta" genérico.
describe("match total vs. parcial", () => {
  it("'obrigado' sozinho (match total) → intercepta", () => {
    expect(matchSynapseDeterministic("obrigado", "lite")).not.toBeNull();
  });

  it("'muito obrigado pela ajuda' (keyword como substring, não sentença inteira) → null", () => {
    expect(matchSynapseDeterministic("muito obrigado pela ajuda", "lite")).toBeNull();
  });

  it("'oi' sozinho (match total) → intercepta", () => {
    expect(matchSynapseDeterministic("oi", "lite")).not.toBeNull();
  });

  it("'oi pessoal, tudo bem com vocês?' (keyword como prefixo de frase maior) → null", () => {
    expect(matchSynapseDeterministic("oi pessoal, tudo bem com vocês?", "lite")).toBeNull();
  });

  it("'tchau' sozinho (match total) → intercepta", () => {
    expect(matchSynapseDeterministic("tchau", "lite")).not.toBeNull();
  });

  it("'tchau, até a próxima reunião sobre o projeto' (keyword seguido de conteúdo real) → null", () => {
    expect(matchSynapseDeterministic("tchau, até a próxima reunião sobre o projeto", "lite")).toBeNull();
  });

  it("'oii' (variação com letra extra) → null — não é a keyword exata", () => {
    expect(matchSynapseDeterministic("oii", "lite")).toBeNull();
  });

  it("'oi?' e 'oi!' (pontuação final tolerada) → intercepta", () => {
    expect(matchSynapseDeterministic("oi?", "lite")).not.toBeNull();
    expect(matchSynapseDeterministic("oi!", "lite")).not.toBeNull();
  });

  it("'ping' isolado com level full (match total) → 'Pong' exato", () => {
    expect(matchSynapseDeterministic("ping", "full")).toBe("Pong");
  });

  it("'me chama de ping pong depois' (keyword no meio de frase real) → null", () => {
    expect(matchSynapseDeterministic("me chama de ping pong depois", "full")).toBeNull();
  });
});

// ── responseSource: cenário misto (parcial e total na mesma conversa) ──────
describe("trySynapseIntercept — sessão mista (parcial vs total)", () => {
  const baseParams = {
    body: {} as Record<string, unknown>,
    sourceFormat: "openai",
    stream: false,
    model: "gpt-4o",
    provider: "openai",
    enabled: true,
    level: "lite" as string | undefined,
    log: undefined,
    reqTag: "[test]",
  };

  it("turno 1 (total, 'oi') intercepta; turno 2 (pergunta real) não intercepta — cada turno é avaliado isoladamente", () => {
    const turn1 = trySynapseIntercept({
      ...baseParams,
      body: { messages: [{ role: "user", content: "oi" }] },
    });
    expect(turn1).not.toBeNull();

    const turn2 = trySynapseIntercept({
      ...baseParams,
      body: {
        messages: [
          { role: "user", content: "oi" },
          { role: "assistant", content: "Olá! Como posso ajudar?" },
          { role: "user", content: "explica o que e recursao em programacao" },
        ],
      },
    });
    expect(turn2).toBeNull();
  });
});

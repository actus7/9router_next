import { afterEach, describe, expect, it, vi } from "vitest";
import { executeChatFetch } from "@/app/(dashboard)/dashboard/basic-chat/hooks/consumeSSEStream";
import { finalizeStreamSuccess } from "@/app/(dashboard)/dashboard/basic-chat/hooks/finalizeStreamResult";
import type { ChatSession } from "@/app/(dashboard)/dashboard/basic-chat/types";

function sseBody(text: string): string {
  const chunk = { choices: [{ delta: { content: text } }] };
  return `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`;
}

function streamResponse(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", ...headers },
  });
}

describe("executeChatFetch — responseSource", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resposta com header X-ModelHub-Response-Source: synapse → responseSource='synapse'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      streamResponse(sseBody("Olá! Como posso ajudar?"), { "X-ModelHub-Response-Source": "synapse" }),
    ));

    const result = await executeChatFetch("/api/v1/chat/completions", {}, () => {});

    expect(result.responseSource).toBe("synapse");
    expect(result.text).toBe("Olá! Como posso ajudar?");
  });

  it("resposta real do LLM sem o header → responseSource=null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      streamResponse(sseBody("Recursão é quando uma função chama a si mesma.")),
    ));

    const result = await executeChatFetch("/api/v1/chat/completions", {}, () => {});

    expect(result.responseSource).toBeNull();
  });

  it("header com valor diferente de 'synapse' é ignorado → responseSource=null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      streamResponse(sseBody("texto"), { "X-ModelHub-Response-Source": "bypass" }),
    ));

    const result = await executeChatFetch("/api/v1/chat/completions", {}, () => {});

    expect(result.responseSource).toBeNull();
  });
});

describe("finalizeStreamSuccess — grava responseSource na mensagem", () => {
  function makeSession(): ChatSession {
    return {
      id: "s1",
      title: "New conversation",
      providerId: "p1",
      providerName: "Provider",
      modelId: "m1",
      modelName: "Model",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [{ id: "assistant-1", role: "assistant", content: "", status: "streaming" }],
    } as ChatSession;
  }

  it("turno determinístico (Synapse): mensagem final fica com responseSource='synapse'", () => {
    let session = makeSession();
    const updateSession = (_id: string, updater: (s: ChatSession) => ChatSession) => { session = updater(session); };
    const recordHarnessEvent = () => {};

    finalizeStreamSuccess("s1", "assistant-1", "Olá! Como posso ajudar?", "oi", updateSession, recordHarnessEvent, {
      usage: null,
      responseSource: "synapse",
    });

    expect(session.messages[0].responseSource).toBe("synapse");
  });

  it("turno real do LLM: mensagem final fica com responseSource=null (sem badge)", () => {
    let session = makeSession();
    const updateSession = (_id: string, updater: (s: ChatSession) => ChatSession) => { session = updater(session); };
    const recordHarnessEvent = () => {};

    finalizeStreamSuccess("s1", "assistant-1", "Recursão é...", "explica recursao", updateSession, recordHarnessEvent, {
      usage: null,
      responseSource: null,
    });

    expect(session.messages[0].responseSource).toBeNull();
  });
});

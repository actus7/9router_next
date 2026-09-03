import { afterEach, describe, expect, it, vi } from "vitest";
import {
  executeChatFetch,
  readRoutingTraceFromError,
} from "@/app/(dashboard)/dashboard/basic-chat/hooks/consumeSSEStream";
import {
  ROUTING_TRACE_EVENT,
  recordRoutingTraceEvent,
} from "@/app/(dashboard)/dashboard/basic-chat/hooks/recordRoutingTraceEvent";
import {
  readRoutingTrace,
  routingTraceLines,
  routingTraceSummary,
} from "@/app/(dashboard)/dashboard/basic-chat/routingTraceLines";
import { classifyEventKind } from "@/app/(dashboard)/dashboard/basic-chat/runJournalHelpers";
import type { HarnessEvent } from "@/app/(dashboard)/dashboard/basic-chat/types";
import {
  ROUTING_TRACE_HEADER,
  serializeRoutingTrace,
  type RoutingTrace,
} from "@/shared/observability/routingTrace";

const COMBO_TRACE: RoutingTrace = {
  requestedModel: "chat",
  selectedModel: "groq/llama-3.3-70b",
  steps: [
    { kind: "combo", name: "chat", strategy: "smart", models: ["quillbot/default", "duckai/gpt-4o-mini"] },
    { kind: "smart", name: "chat", need: "general", tier: "balanced", reason: "endpoint", candidates: ["quillbot/default", "groq/llama-3.3-70b"] },
    { kind: "attempt", model: "quillbot/default", index: 1, total: 2, outcome: "failed", status: 403, error: "Forbidden" },
    { kind: "account", provider: "groq", model: "llama-3.3-70b", connection: "groq-main", outcome: "selected" },
  ],
};

function sseBody(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
}

function harnessEvent(data: Record<string, unknown>): HarnessEvent {
  return { sessionId: "s1", seq: 1, type: ROUTING_TRACE_EVENT, data, createdAt: new Date().toISOString() };
}

describe("executeChatFetch — routing trace header", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lê X-ModelHub-Routing da resposta de streaming", async () => {
    const header = serializeRoutingTrace(COMBO_TRACE) as string;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(sseBody("oi"), {
      status: 200,
      headers: { "Content-Type": "text/event-stream", [ROUTING_TRACE_HEADER]: header },
    })));

    const result = await executeChatFetch("/api/v1/chat/completions", {}, () => {});

    expect(result.routingTrace?.requestedModel).toBe("chat");
    expect(result.routingTrace?.selectedModel).toBe("groq/llama-3.3-70b");
    expect(result.routingTrace?.steps).toHaveLength(4);
  });

  it("sem o header → routingTrace null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(sseBody("oi"), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    })));

    const result = await executeChatFetch("/api/v1/chat/completions", {}, () => {});

    expect(result.routingTrace).toBeNull();
  });

  it("resposta de erro ainda entrega o trace pelo erro lançado", async () => {
    const failed: RoutingTrace = { requestedModel: "chat", steps: [
      { kind: "attempt", model: "quillbot/default", index: 1, total: 1, outcome: "failed", status: 403, error: "Forbidden" },
    ] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", {
      status: 502,
      headers: { [ROUTING_TRACE_HEADER]: serializeRoutingTrace(failed) as string },
    })));

    const error = await executeChatFetch("/api/v1/chat/completions", {}, () => {}).catch((err: unknown) => err);

    expect(readRoutingTraceFromError(error)?.steps).toHaveLength(1);
    expect(readRoutingTraceFromError(new Error("boom"))).toBeNull();
  });
});

describe("recordRoutingTraceEvent", () => {
  it("grava um evento routing/trace achatado com o runId da mensagem", () => {
    const record = vi.fn();

    recordRoutingTraceEvent(record, "s1", "run-1", COMBO_TRACE);

    expect(record).toHaveBeenCalledWith("s1", ROUTING_TRACE_EVENT, {
      runId: "run-1",
      requestedModel: "chat",
      selectedModel: "groq/llama-3.3-70b",
      steps: COMBO_TRACE.steps,
    });
  });

  it("não grava nada quando não há trace ou quando ele está vazio", () => {
    const record = vi.fn();

    recordRoutingTraceEvent(record, "s1", "run-1", null);
    recordRoutingTraceEvent(record, "s1", "run-1", { requestedModel: "chat", steps: [] });

    expect(record).not.toHaveBeenCalled();
  });
});

describe("journal rendering", () => {
  it("routing/trace conta como evento de sistema", () => {
    expect(classifyEventKind(harnessEvent({ requestedModel: "chat", steps: [] }))).toBe("system");
  });

  it("readRoutingTrace ignora data sem requestedModel e passos malformados", () => {
    expect(readRoutingTrace({ steps: [] })).toBeNull();
    expect(readRoutingTrace({ requestedModel: "chat", steps: [{ nope: true }, COMBO_TRACE.steps[0]] })?.steps).toEqual([
      COMBO_TRACE.steps[0],
    ]);
  });

  it("o resumo nomeia o modelo que respondeu e quantas tentativas falharam", () => {
    expect(routingTraceSummary(COMBO_TRACE)).toBe("chat → groq/llama-3.3-70b after 1 failed attempt");
    expect(routingTraceSummary({ requestedModel: "chat", steps: [] })).toBe("chat → no model answered");
  });

  it("as linhas descrevem combo, smart routing e cada tentativa, terminando no resultado", () => {
    const lines = routingTraceLines(COMBO_TRACE);

    expect(lines[0].title).toContain('Combo "chat"');
    expect(lines[0].detail).toContain("quillbot/default");
    expect(lines[1].title).toContain("need general");
    expect(lines[2]).toMatchObject({ tone: "fail", detail: "Forbidden" });
    expect(lines[3].tone).toBe("ok");
    expect(lines[lines.length - 1]).toMatchObject({ tone: "ok", title: "Answered by groq/llama-3.3-70b" });
  });

  it("sinaliza trace truncado e ausência de resposta", () => {
    const lines = routingTraceLines({ requestedModel: "chat", steps: [], truncated: true });

    expect(lines[0].title).toContain("truncated");
    expect(lines[1]).toMatchObject({ tone: "fail", title: "No model answered this request" });
  });
});

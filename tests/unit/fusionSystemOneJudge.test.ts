import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleFusionChat } from "@/server/llm-gateway/engine/services/comboFusion";
import {
  isSystemOneModel,
  setFusionJudge,
  type FusionJudge,
  type FusionJudgeInput,
} from "@/server/llm-gateway/engine/host/fusionJudge";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function openAiAnswer(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: text } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const baseBody = { model: "combo", messages: [{ role: "user", content: "What is 2+2?" }] };

// Panel models answer with their own name; any judge call (extra user turn) answers "LLM-JUDGE".
function makeHandler() {
  const calls: Array<{ model: string; body: Record<string, unknown> }> = [];
  const handler = vi.fn(async (body: Record<string, unknown>, model: string) => {
    calls.push({ model, body });
    // The judge call is the one carrying the appended "judge" user turn.
    const isJudgeCall = (body.messages as unknown[]).length > baseBody.messages.length;
    return isJudgeCall ? openAiAnswer("LLM-JUDGE") : openAiAnswer(`answer from ${model}`);
  });
  return { handler, calls };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => setFusionJudge(null));

describe("isSystemOneModel", () => {
  it("recognises TypeSafe System One model ids only", () => {
    expect(isSystemOneModel("typesafe-ai/jev")).toBe(true);
    expect(isSystemOneModel("typesafe-ai/laya")).toBe(true);
    expect(isSystemOneModel("oc/big-pickle")).toBe(false);
    expect(isSystemOneModel("")).toBe(false);
  });
});

describe("fusion with a System One judge", () => {
  it("returns the panel answer the judge picks, with no extra LLM call", async () => {
    const judge: FusionJudge = vi.fn(async () => ({ index: 1, confidence: 0.9 }));
    setFusionJudge(judge);
    const { handler, calls } = makeHandler();

    const res = await handleFusionChat({
      body: baseBody, models: ["p1", "p2"], handleSingleModel: handler, log,
      comboName: "c", judgeModel: "typesafe-ai/jev",
    });

    const json = await res.json();
    expect(JSON.stringify(json)).toContain("answer from p2");
    expect(calls.map((c) => c.model).sort()).toEqual(["p1", "p2"]);
    expect(judge).toHaveBeenCalledOnce();
  });

  it("hands the judge the user's request and the anonymised answers", async () => {
    const judge = vi.fn(async (_input: FusionJudgeInput) => ({ index: 0, confidence: 0.9 }));
    setFusionJudge(judge);
    await handleFusionChat({
      body: baseBody, models: ["p1", "p2"], handleSingleModel: makeHandler().handler, log,
      judgeModel: "typesafe-ai/jev",
    });
    const input = judge.mock.calls[0][0];
    expect(input.model).toBe("typesafe-ai/jev");
    expect(input.request).toContain("What is 2+2?");
    expect(input.answers.map((a: { text: string }) => a.text).sort()).toEqual(["answer from p1", "answer from p2"]);
  });

  it("answers in SSE when the client asked for a stream", async () => {
    setFusionJudge(async () => ({ index: 0, confidence: 0.9 }));
    const res = await handleFusionChat({
      body: { ...baseBody, stream: true }, models: ["p1", "p2"], handleSingleModel: makeHandler().handler, log,
      judgeModel: "typesafe-ai/jev",
    });
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(await res.text()).toContain("answer from p1");
  });

  it("falls back to the LLM judge (first panel model) when confidence is low", async () => {
    setFusionJudge(async () => ({ index: 1, confidence: 0.2 }));
    const { handler, calls } = makeHandler();
    const res = await handleFusionChat({
      body: baseBody, models: ["p1", "p2"], handleSingleModel: handler, log, judgeModel: "typesafe-ai/jev",
    });
    expect(JSON.stringify(await res.json())).toContain("LLM-JUDGE");
    // The System One id must never be sent to the provider router as a model.
    expect(calls.map((c) => c.model)).not.toContain("typesafe-ai/jev");
    expect(calls.at(-1)?.model).toBe("p1");
  });

  it("falls back to the LLM judge when the System One judge is unavailable", async () => {
    setFusionJudge(async () => null);
    const { handler, calls } = makeHandler();
    await handleFusionChat({
      body: baseBody, models: ["p1", "p2"], handleSingleModel: handler, log, judgeModel: "typesafe-ai/jev",
    });
    expect(calls.at(-1)?.model).toBe("p1");
  });

  it("falls back when no judge is installed at all", async () => {
    const { handler, calls } = makeHandler();
    await handleFusionChat({
      body: baseBody, models: ["p1", "p2"], handleSingleModel: handler, log, judgeModel: "typesafe-ai/jev",
    });
    expect(calls.at(-1)?.model).toBe("p1");
  });

  it("an LLM judge model keeps the synthesis path untouched", async () => {
    const judge = vi.fn();
    setFusionJudge(judge);
    const { handler, calls } = makeHandler();
    await handleFusionChat({
      body: baseBody, models: ["p1", "p2"], handleSingleModel: handler, log, judgeModel: "judge-llm",
    });
    expect(judge).not.toHaveBeenCalled();
    expect(calls.at(-1)?.model).toBe("judge-llm");
  });
});

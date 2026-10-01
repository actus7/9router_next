import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Jev-first loop control in the worker's tool loop.
 *
 * Two judgements, both upgrades over a fixed rule the loop already has: one
 * retry for a failed call that produced nothing useful, and stopping when the
 * answer is already complete despite the model asking for more tools. Both
 * fail to today's behaviour on a null answer — and the hard rules (step
 * ceiling, deadline, hand-back, onProgress stop) are untouched by design.
 */

const handleChat = vi.hoisted(() => vi.fn());
const executeServerToolCall = vi.hoisted(() => vi.fn());
const decideWithJev = vi.hoisted(() => vi.fn());
const scanUntrustedContent = vi.hoisted(() => vi.fn(async () => ({ issues: [], source: "heuristic" })));

vi.mock("@/server/llm-gateway/chat", () => ({ handleChat }));
vi.mock("@/server/harness/tools/serverToolCall", () => ({
  executeServerToolCall,
  SERVER_EXECUTABLE_TOOLS: new Set(["web_search", "web_fetch", "delegate_task"]),
}));
vi.mock("@/server/decisions/jev", () => ({ decideWithJev }));
vi.mock("@/server/decisions/guardrails", () => ({ scanUntrustedContent }));

import { runServerToolLoop } from "@/server/harness/tools/serverToolLoop";

const useful = (probability: number) => ({ answers: { useful: { type: "boolean", probability } }, source: "jev" });
const complete = (probability: number) => ({ answers: { complete: { type: "boolean", probability } }, source: "jev" });

/** Jev answers only the question kind this test exercises. */
function jevSays(usefulAnswer: unknown, completeAnswer: unknown = null) {
  decideWithJev.mockImplementation(async (_feature, _state, questions) => {
    if ("useful" in questions) return usefulAnswer;
    if ("complete" in questions) return completeAnswer;
    return null;
  });
}

/** A chat answer with no further tool calls: the loop's exit condition. */
function finalAnswer(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

/** A chat answer that asks for one more tool. */
function asksFor(name: string, id = "call_next") {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: "", tool_calls: [{ id, type: "function", function: { name, arguments: "{}" } }] } }],
    }),
    { status: 200 },
  );
}

const body = {
  model: "provider/model",
  messages: [{ role: "user", content: "find something" }],
  tools: [
    { type: "function", function: { name: "web_search" } },
    { type: "function", function: { name: "some_future_tool" } },
  ],
};

function loop(overrides: Partial<Parameters<typeof runServerToolLoop>[0]> = {}) {
  return runServerToolLoop({
    body,
    authorization: null,
    sessionId: "s1",
    model: "provider/model",
    firstTurnText: "",
    firstTurnToolCalls: [{ id: "call_1", name: "web_search", arguments: '{"query":"x"}' }],
    onProgress: async () => true,
    deadline: Date.now() + 60_000,
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  executeServerToolCall.mockResolvedValue('{"ok":true,"result":[]}');
  decideWithJev.mockResolvedValue(null);
});

describe("retry of a useless failed call", () => {
  it("re-executes the same call exactly once when Jev sees nothing useful", async () => {
    executeServerToolCall.mockResolvedValue('{"ok":false,"error":"upstream"}');
    jevSays(useful(0.1));
    handleChat.mockResolvedValue(finalAnswer("done"));

    const result = await loop();

    expect(executeServerToolCall).toHaveBeenCalledTimes(2);
    expect(executeServerToolCall.mock.calls[1]?.[0]).toEqual(executeServerToolCall.mock.calls[0]?.[0]);
    expect(decideWithJev).toHaveBeenCalledTimes(1);
    expect(result.executed).toBe(1);
    expect(result.text).toBe("done");
  });

  it("does not retry when Jev finds the failure at least somewhat useful", async () => {
    executeServerToolCall.mockResolvedValue('{"ok":false,"error":"upstream"}');
    jevSays(useful(0.6));
    handleChat.mockResolvedValue(finalAnswer("done"));

    await loop();

    expect(executeServerToolCall).toHaveBeenCalledOnce();
  });

  it("does not retry when Jev has no answer", async () => {
    executeServerToolCall.mockResolvedValue('{"ok":false,"error":"upstream"}');
    jevSays(null);
    handleChat.mockResolvedValue(finalAnswer("done"));

    await loop();

    expect(executeServerToolCall).toHaveBeenCalledOnce();
    expect(decideWithJev).toHaveBeenCalledOnce();
  });
});

describe("early stop", () => {
  it("ends the turn when Jev says the answer is already complete", async () => {
    handleChat.mockResolvedValueOnce(asksFor("web_search", "call_2"));
    jevSays(null, complete(0.95));

    const result = await loop({ firstTurnText: "here is the answer" });

    expect(handleChat).toHaveBeenCalledOnce();
    expect(executeServerToolCall).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ text: "here is the answer", leftoverToolCalls: [], exhausted: false, executed: 1 });
  });

  it("keeps going below the threshold", async () => {
    handleChat.mockResolvedValueOnce(asksFor("web_search", "call_2")).mockResolvedValueOnce(finalAnswer("done"));
    jevSays(null, complete(0.7));

    const result = await loop();

    expect(executeServerToolCall).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ text: "done", leftoverToolCalls: [], exhausted: false, executed: 2 });
  });

  it("never asks before the first tool step has produced an answer", async () => {
    handleChat.mockResolvedValue(finalAnswer("done"));
    jevSays(null, complete(0.99));

    await loop();

    expect(decideWithJev).not.toHaveBeenCalled();
  });
});

describe("the hard rules survive", () => {
  it("keeps the 8-step ceiling when Jev never has an opinion", async () => {
    handleChat.mockImplementation(async () => asksFor("web_search"));

    const result = await loop();

    expect(handleChat).toHaveBeenCalledTimes(8);
    expect(result.exhausted).toBe(true);
    expect(result.leftoverToolCalls).not.toEqual([]);
  });

  it("still hands a call back before executing anything", async () => {
    const result = await loop({
      firstTurnToolCalls: [
        { id: "call_1", name: "web_search", arguments: "{}" },
        { id: "call_2", name: "some_future_tool", arguments: "{}" },
      ],
    });

    expect(executeServerToolCall).not.toHaveBeenCalled();
    expect(handleChat).not.toHaveBeenCalled();
    expect(decideWithJev).not.toHaveBeenCalled();
    expect(result.leftoverToolCalls.map((call) => call.id)).toEqual(["call_1", "call_2"]);
    expect(result.executed).toBe(0);
  });
});

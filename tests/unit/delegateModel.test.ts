import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `delegate_task` model choice: an explicit `model` always wins; the default
 * is Jev's typed pick over the cheap end of the catalogue, and anything weak
 * or out-of-list falls back to the run's own model — today's behaviour.
 */

const decideWithJev = vi.hoisted(() => vi.fn());
const buildModelsList = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
const handleChat = vi.hoisted(() => vi.fn());
const handleFetch = vi.hoisted(() => vi.fn());
const handleSearch = vi.hoisted(() => vi.fn());
const callSessionMcpTool = vi.hoisted(() => vi.fn());

vi.mock("@/server/decisions/jev", () => ({ decideWithJev }));
vi.mock("@/server/application/use-cases/http/v1/models/route", () => ({ buildModelsList }));
vi.mock("@/server/llm-gateway/chat", () => ({ handleChat }));
vi.mock("@/server/llm-gateway/application/fetch", () => ({ handleFetch }));
vi.mock("@/server/llm-gateway/application/search", () => ({ handleSearch }));
vi.mock("@/server/harness/mcpClient", () => ({ callSessionMcpTool }));
vi.mock("@/server/harness/tools/serverMediaTools", () => ({
  generateImageServerSide: vi.fn(),
  generateVideoServerSide: vi.fn(),
  textToSpeechServerSide: vi.fn(),
}));
vi.mock("@/server/harness/tools/serverHarnessTools", () => ({
  SERVER_HARNESS_TOOLS: new Set<string>(),
  executeHarnessToolServerSide: vi.fn(async () => null),
}));

import { executeServerToolCall, type ServerToolContext } from "@/server/harness/tools/serverToolCall";

const context: ServerToolContext = {
  sessionId: "s1",
  authorization: null,
  enabledToolNames: new Set(["delegate_task"]),
  mcpRuntimeNames: new Set(),
  model: "run/model",
  deadline: Date.now() + 60_000,
};

let chatBody: Record<string, unknown> | null = null;

function jevChoice(choice: string, confidence: number) {
  return { answers: { model: { type: "choice", choice, confidence, probabilities: {} } }, source: "jev" };
}

async function delegate(args: Record<string, unknown>, ctx: ServerToolContext = context) {
  return executeServerToolCall(
    { id: "call_1", name: "delegate_task", arguments: JSON.stringify({ task: "summarize this", ...args }) },
    ctx,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  chatBody = null;
  decideWithJev.mockResolvedValue(null);
  buildModelsList.mockResolvedValue([
    { id: "a/cheap" },
    { id: "run/model" },
    { id: "b/good" },
    { id: "a/cheap" },
    { id: "router", kind: "smart" },
  ]);
  handleChat.mockImplementation(async (request: Request) => {
    chatBody = JSON.parse(await request.text()) as Record<string, unknown>;
    return new Response(JSON.stringify({ choices: [{ message: { content: "delegated" } }] }), { status: 200 });
  });
});

describe("delegate_task model choice", () => {
  it("runs on Jev's confident pick from the candidate list", async () => {
    decideWithJev.mockResolvedValue(jevChoice("b/good", 0.8));

    const result = await delegate({});

    expect(chatBody?.model).toBe("b/good");
    expect(JSON.parse(result as string)).toMatchObject({ ok: true, result: "delegated" });
    const state = decideWithJev.mock.calls[0]?.[1] as { task: string; candidates: string[] };
    // The run's own model goes first; duplicates and non-LLM kinds do not.
    expect(state.candidates).toEqual(["run/model", "a/cheap", "b/good"]);
    expect(state.task).toContain("summarize this");
  });

  it("falls back to the run's model when the choice is outside the candidates", async () => {
    decideWithJev.mockResolvedValue(jevChoice("z/rogue", 0.9));

    await delegate({});

    expect(chatBody?.model).toBe("run/model");
  });

  it("falls back to the run's model when Jev does not answer", async () => {
    await delegate({});

    expect(chatBody?.model).toBe("run/model");
  });

  it("never consults Jev when the caller named a model", async () => {
    await delegate({ model: "x/explicit" });

    expect(decideWithJev).not.toHaveBeenCalled();
    expect(chatBody?.model).toBe("x/explicit");
  });

  it("offers the run's model even when the catalogue does not list it", async () => {
    buildModelsList.mockResolvedValue([{ id: "a/cheap" }]);
    decideWithJev.mockResolvedValue(null);

    await delegate({});

    const state = decideWithJev.mock.calls[0]?.[1] as { candidates: string[] };
    expect(state.candidates).toEqual(["run/model", "a/cheap"]);
    expect(chatBody?.model).toBe("run/model");
  });
});

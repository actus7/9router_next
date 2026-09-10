import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The tool loop moved from the browser into the worker.
 *
 * This was the last thing a closed tab still stopped: each step was durable,
 * but the loop between steps ran in `runToolCallLoop`, so a turn needing a
 * second tool step waited for a browser that might never come back.
 *
 * The load-bearing property is that the two loops never both run a call. A
 * step is all-or-nothing: if any call in it needs the browser, none run here
 * and the whole set is handed back on the settled row.
 */

const handleChat = vi.hoisted(() => vi.fn());
const executeServerToolCall = vi.hoisted(() => vi.fn());

vi.mock("@/server/llm-gateway/chat", () => ({ handleChat }));
vi.mock("@/server/harness/tools/serverToolCall", async () => {
  const actual = await vi.importActual<typeof import("@/server/harness/tools/serverToolCall")>(
    "@/server/harness/tools/serverToolCall",
  );
  return { ...actual, executeServerToolCall };
});

import { runServerToolLoop, toolNamesFromBody } from "@/server/harness/tools/serverToolLoop";

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
    { type: "function", function: { name: "generate_image" } },
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
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  executeServerToolCall.mockResolvedValue('{"ok":true,"result":[]}');
});

describe("server tool loop", () => {
  it("finishes a tool turn with no browser involved", async () => {
    handleChat.mockResolvedValue(finalAnswer("here is what I found"));

    const result = await loop();

    expect(executeServerToolCall).toHaveBeenCalledOnce();
    expect(result.text).toBe("here is what I found");
    expect(result.leftoverToolCalls).toEqual([]);
    expect(result.executed).toBe(1);
  });

  it("hands a browser-only call back without running any of the step", async () => {
    // `generate_image` needs the provider/model resolution that lives in the
    // browser. Running the rest of the step here and the rest there would
    // execute the same call twice.
    const result = await loop({
      firstTurnToolCalls: [
        { id: "call_1", name: "web_search", arguments: "{}" },
        { id: "call_2", name: "generate_image", arguments: "{}" },
      ],
    });

    expect(executeServerToolCall).not.toHaveBeenCalled();
    expect(handleChat).not.toHaveBeenCalled();
    expect(result.leftoverToolCalls.map((call) => call.id)).toEqual(["call_1", "call_2"]);
    expect(result.executed).toBe(0);
  });

  it("ends the turn rather than handing back a history it already advanced", async () => {
    // The tool results of step one live in the loop's own message list, not in
    // the client's conversation. Handing step two to the browser would make it
    // continue from a history missing step one, and the model would answer
    // without it — so once this side has run a step, the turn ends here.
    handleChat.mockResolvedValueOnce(asksFor("generate_image", "call_2"));

    const result = await loop({ firstTurnText: "looking" });

    expect(executeServerToolCall).toHaveBeenCalledOnce();
    expect(result.leftoverToolCalls).toEqual([]);
    expect(result.exhausted).toBe(true);
    expect(result.text).toBe("looking");
  });

  it("chains several steps and keeps the text of each", async () => {
    handleChat
      .mockResolvedValueOnce(asksFor("web_search", "call_2"))
      .mockResolvedValueOnce(finalAnswer("done"));

    const result = await loop({ firstTurnText: "looking" });

    expect(executeServerToolCall).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("looking\n\ndone");
    expect(result.exhausted).toBe(false);
  });

  it("stops at the step ceiling and reports it instead of looping forever", async () => {
    handleChat.mockImplementation(async () => asksFor("web_search"));

    const result = await loop();

    expect(handleChat).toHaveBeenCalledTimes(8);
    expect(result.exhausted).toBe(true);
    expect(result.leftoverToolCalls).not.toEqual([]);
  });

  it("gives up the moment the run stops being ours to write", async () => {
    // `updateHarnessRunProgress` matching no row is how a stop reaches the
    // worker. Continuing past it would keep spending on a cancelled run.
    handleChat.mockImplementation(async () => asksFor("web_search"));

    const result = await loop({ onProgress: async () => false });

    expect(handleChat).toHaveBeenCalledOnce();
    expect(result.leftoverToolCalls).toEqual([]);
  });

  it("raises a failed continuation instead of settling a half answer", async () => {
    handleChat.mockResolvedValue(
      new Response(JSON.stringify({ error: "provider exhausted" }), { status: 502 }),
    );

    await expect(loop()).rejects.toThrow(/provider exhausted/);
  });
});

describe("toolNamesFromBody", () => {
  it("reads the enabled tools from what was offered to the model", () => {
    // No separate session lookup, so the worker and the browser cannot
    // disagree about which tools this turn had.
    expect([...toolNamesFromBody(body)]).toEqual(["web_search", "generate_image"]);
  });

  it("survives a body with no tools at all", () => {
    expect([...toolNamesFromBody({})]).toEqual([]);
  });
});

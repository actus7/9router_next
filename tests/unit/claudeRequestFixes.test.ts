import { describe, expect, it } from "vitest";

import {
  anchorClaudeCache,
  ensureTrailingUserTurn,
  prepareClaudeRequest,
} from "@/server/llm-gateway/engine/translator/formats/claude";
import { detectClientLastRole, translateRequest } from "@/server/llm-gateway/engine/translator";
import { FORMATS } from "@/server/llm-gateway/engine/translator/formats";

type Block = Record<string, unknown>;
type Message = { role: string; content: string | Block[] };
type Body = { messages: Message[]; system?: Block[]; tools?: Block[] } & Record<string, unknown>;

const text = (t: string): Block => ({ type: "text", text: t });
const toolUse: Block = { type: "tool_use", id: "tu_1", name: "read", input: {} };
const toolResult: Block = { type: "tool_result", tool_use_id: "tu_1", content: "ok" };

function prepare(body: Body): Body {
  return prepareClaudeRequest(structuredClone(body)) as Body;
}

// A user turn whose only block is a Files API reference is valid Anthropic input. It
// counted as empty and was dropped, so the provider got `messages: []`.
describe("Claude request: container_upload", () => {
  it("keeps a user turn whose only block is a file reference", () => {
    const out = prepare({ messages: [{ role: "user", content: [{ type: "container_upload", file_id: "file_1" }] }] });

    expect(out.messages).toHaveLength(1);
    expect(out.messages[0].content).toEqual([{ type: "container_upload", file_id: "file_1" }]);
  });

  it("still drops a turn that really is empty", () => {
    const out = prepare({ messages: [{ role: "user", content: "hi" }, { role: "assistant", content: [text("ok")] }, { role: "user", content: [text("   ")] }, { role: "user", content: "again" }] });

    expect(out.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });
});

// In an agent's tool loop a request ends with the results of the last assistant turn's
// tool calls, after that turn's breakpoint: they are paid at full input price and the next
// request writes them to the cache. With room in the 4-marker budget, a breakpoint on
// that final turn caches them now.
describe("Claude request: cache breakpoint on a tool loop's final results", () => {
  const loop = (): Body => ({
    system: [text("sys")],
    tools: [{ name: "read", input_schema: { type: "object" } }],
    messages: [
      { role: "user", content: "go" },
      { role: "assistant", content: [toolUse] },
      { role: "user", content: [toolResult] },
    ],
  });

  const marked = (m: Message): boolean => Array.isArray(m.content) && m.content.some((b) => b.cache_control);
  const total = (b: Body): number =>
    [...(b.system ?? []), ...(b.tools ?? []), ...b.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []))].filter((x) => x.cache_control).length;

  it("marks the final tool results when the budget has room", () => {
    const out = prepare(loop());

    expect(marked(out.messages[2])).toBe(true);
    expect(out.messages[2].content).toEqual([{ ...toolResult, cache_control: { type: "ephemeral" } }]);
    expect(total(out)).toBe(4);
  });

  it("does the same on a passthrough body", () => {
    const out = anchorClaudeCache(structuredClone(loop())) as Body;

    expect(marked(out.messages[2])).toBe(true);
    expect(total(out)).toBeLessThanOrEqual(4);
  });

  it("leaves a final turn that carries no tool result alone", () => {
    const body = loop();
    body.messages[2] = { role: "user", content: [text("and then?")] };

    expect(marked(prepare(body).messages[2])).toBe(false);
  });

  it("never goes over the four-breakpoint limit", () => {
    const body = loop();
    body.messages.splice(1, 0, { role: "assistant", content: [text("earlier")] }, { role: "user", content: "more" });

    expect(total(prepare(body))).toBeLessThanOrEqual(4);
  });
});

// Newer Claude models reject a body that ends on an assistant turn ("does not support
// assistant message prefill"). Cleanup deletes turns left empty, so a trailing user turn that
// was empty silently made the previous assistant turn the last one.
describe("ensureTrailingUserTurn", () => {
  const assistantLast: Message[] = [{ role: "user", content: "hi" }, { role: "assistant", content: [text("ok")] }];

  it("adds a user turn when cleanup left the conversation ending on the assistant", () => {
    const out = ensureTrailingUserTurn(assistantLast, "user");

    expect(out).toHaveLength(3);
    expect(out[2].role).toBe("user");
    expect(out).not.toBe(assistantLast);
  });

  it("respects a client that ended on the assistant itself: that is real prefill", () => {
    expect(ensureTrailingUserTurn(assistantLast, "assistant")).toBe(assistantLast);
  });

  it("leaves a conversation that already ends on the user alone", () => {
    const messages: Message[] = [{ role: "assistant", content: [text("ok")] }, { role: "user", content: "hi" }];
    expect(ensureTrailingUserTurn(messages, "user")).toBe(messages);
  });
});

describe("Claude request: a trailing user turn that cleanup emptied", () => {
  it("is restored, so the body does not end on assistant", () => {
    const out = prepare({ messages: [{ role: "user", content: "hi" }, { role: "assistant", content: [text("ok")] }, { role: "user", content: [text("  ")] }] });

    expect(out.messages.at(-1)?.role).toBe("user");
  });

  it("keeps an intentional prefill", () => {
    const out = prepare({ messages: [{ role: "user", content: "hi" }, { role: "assistant", content: [text("The answer is")] }] });

    expect(out.messages.at(-1)?.role).toBe("assistant");
  });

  it("holds through translateRequest for an OpenAI client", () => {
    const body = { model: "claude-sonnet-5-5", messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "ok" }, { role: "user", content: "" }] };

    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-5-5", structuredClone(body), false, null, "claude") as Body;

    expect(out.messages.at(-1)?.role).toBe("user");
  });
});

describe("detectClientLastRole", () => {
  it("reads messages[], contents[] and input[], and only an assistant/model tail counts as assistant", () => {
    expect(detectClientLastRole({ messages: [{ role: "user" }, { role: "assistant" }] })).toBe("assistant");
    expect(detectClientLastRole({ contents: [{ role: "user" }, { role: "model" }] })).toBe("assistant");
    expect(detectClientLastRole({ input: [{ role: "assistant" }] })).toBe("assistant");
    expect(detectClientLastRole({ contents: [{ role: "model" }, { role: "user" }] })).toBeUndefined();
    expect(detectClientLastRole({ input: [{ type: "function_call_output" }] })).toBeUndefined();
    expect(detectClientLastRole({})).toBeUndefined();
  });
});

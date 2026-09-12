import { beforeAll, describe, expect, it } from "vitest";

import {
  initState,
  initTranslators,
  translateRequest,
  translateResponse,
} from "@/server/llm-gateway/engine/translator";
import { FORMATS } from "@/server/llm-gateway/engine/translator/formats";

/**
 * The gateway's public promise, asserted as behaviour.
 *
 * ARCHITECTURE.md states it plainly: "The public gateway protocols remain
 * stable: OpenAI chat/Responses/embeddings, Anthropic, Gemini and SSE." Until
 * now the only translator test checked that translators were *registered* --
 * needsTranslation(openai, claude) === true -- which stays green no matter what
 * comes out the other end. ~3.5k statements of request and response translation
 * sat under 10% coverage, and a regression there breaks every client of the
 * gateway silently, in the one layer no provider error surfaces.
 *
 * Every assertion below is taken from the target API's own published shape, not
 * from what this code happens to emit today. That distinction is the point: a
 * test written against current output would lock in whatever is already wrong.
 */

beforeAll(() => {
  initTranslators();
});

/** The lowest common denominator of an OpenAI chat request. */
function openAiRequest(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model: "m",
    messages: [
      { role: "system", content: "Seja conciso." },
      { role: "user", content: "Oi" },
    ],
    max_tokens: 64,
    ...extra,
  };
}

const OPENAI_TOOL = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Current weather",
    parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  },
};

describe("OpenAI -> Claude request", () => {
  it("hoists the system prompt out of messages, where Claude expects it", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "m", openAiRequest(), false) as Record<string, unknown>;
    // Anthropic's Messages API takes a top-level `system` field and rejects
    // `role: "system"` inside `messages`. This is the single most load-bearing
    // difference between the two request shapes.
    expect(out.system).toBeDefined();
    const messages = out.messages as { role: string }[];
    expect(messages.every((message) => message.role !== "system")).toBe(true);
    expect(JSON.stringify(out.system)).toContain("Seja conciso.");
  });

  it("keeps max_tokens, which Anthropic requires and OpenAI does not", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "m", openAiRequest(), false) as Record<string, unknown>;
    expect(out.max_tokens).toBeTypeOf("number");
  });

  it("rewrites a function tool into the Anthropic input_schema shape", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "m", openAiRequest({ tools: [OPENAI_TOOL] }), false) as Record<string, unknown>;
    const tools = out.tools as Record<string, unknown>[];
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("get_weather");
    // Anthropic names the JSON Schema `input_schema`; OpenAI names it
    // `parameters` and nests it under `function`. A tool that arrives with the
    // wrong key is a tool the model never sees.
    expect(tools[0].input_schema).toMatchObject({ type: "object" });
    expect(tools[0].function).toBeUndefined();
  });
});

describe("Claude -> OpenAI request", () => {
  it("folds the top-level system field back into messages", () => {
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "m", {
      model: "m",
      system: "Seja breve.",
      messages: [{ role: "user", content: "Oi" }],
      max_tokens: 32,
    }, false) as Record<string, unknown>;
    const messages = out.messages as { role: string; content: unknown }[];
    // The mirror of the hoist above: OpenAI has no top-level `system`, so a
    // dropped one silently discards the caller's instructions.
    expect(messages.some((message) => message.role === "system")).toBe(true);
    expect(JSON.stringify(messages)).toContain("Seja breve.");
  });

  it("rewrites an Anthropic tool into the OpenAI nested function shape", () => {
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "m", {
      model: "m",
      messages: [{ role: "user", content: "Oi" }],
      max_tokens: 32,
      tools: [
        {
          name: "get_weather",
          description: "Current weather",
          input_schema: { type: "object", properties: { city: { type: "string" } } },
        },
      ],
    }, false) as Record<string, unknown>;
    const tools = out.tools as Record<string, Record<string, unknown>>[];
    expect(tools[0].function.name).toBe("get_weather");
    expect(tools[0].function.parameters).toMatchObject({ type: "object" });
  });
});

describe("OpenAI -> Gemini request", () => {
  it("moves messages into contents and renames the assistant role to model", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.GEMINI, "m", {
      model: "m",
      messages: [
        { role: "user", content: "Oi" },
        { role: "assistant", content: "Ola" },
        { role: "user", content: "E ai" },
      ],
    }, false) as Record<string, unknown>;
    const contents = out.contents as { role: string; parts: unknown[] }[];
    expect(Array.isArray(contents)).toBe(true);
    // The only roles Gemini accepts are `user` and `model`; `assistant` is not
    // one of them and a turn labelled that way is rejected outright.
    expect(contents.some((entry) => entry.role === "model")).toBe(true);
    expect(contents.every((entry) => entry.role !== "assistant")).toBe(true);
    expect(Array.isArray(contents[0].parts)).toBe(true);
  });
});

/**
 * In translateResponse(targetFormat, sourceFormat, ...) the names read
 * backwards: step 1 is target -> openai and step 2 is openai -> source, so
 * targetFormat is the *provider's* format and sourceFormat is the *client's*.
 * Worth pinning down in a test, because calling it the intuitive way round
 * returns the chunk untouched rather than failing.
 */
describe("response translation", () => {
  it("turns a Claude text delta into an OpenAI chunk", () => {
    const state = initState(FORMATS.OPENAI);
    const out = translateResponse(FORMATS.CLAUDE, FORMATS.OPENAI, {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Ola" },
    }, state) as Record<string, unknown>[];
    const text = JSON.stringify(out);
    expect(text).toContain("Ola");
    // An OpenAI streaming chunk carries the token under choices[].delta.
    expect(text).toContain("delta");
  });

  it("passes a chunk through untouched when both sides speak the same format", () => {
    const chunk = { id: "c1", choices: [{ delta: { content: "oi" } }] };
    const out = translateResponse(FORMATS.OPENAI, FORMATS.OPENAI, chunk, initState(FORMATS.OPENAI));
    expect(out).toEqual([chunk]);
    expect(out[0]).toBe(chunk);
  });

  it("turns an OpenAI chunk into Claude SSE events", () => {
    const state = initState(FORMATS.CLAUDE);
    const events = translateResponse(FORMATS.OPENAI, FORMATS.CLAUDE, {
      id: "c1",
      object: "chat.completion.chunk",
      model: "m",
      choices: [{ index: 0, delta: { content: "Ola" }, finish_reason: null }],
    }, state) as Record<string, unknown>[];
    expect(Array.isArray(events)).toBe(true);
    // The Anthropic stream is a sequence of typed events, not bare deltas: a
    // client reading `type` finds nothing in an OpenAI chunk.
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).toContain("Ola");
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  inspectSSELine,
  isNoRetryFinish,
  isZeroContentResponse,
  peekForContent,
} from "@/server/llm-gateway/engine/services/comboEmptyGuard";
import { handleComboChat } from "@/server/llm-gateway/engine/services/combo";

/**
 * Some upstreams answer HTTP 200 and then stream nothing usable (Gemini aborts with
 * MALFORMED_FUNCTION_CALL and still sends a terminal frame). The combo saw a 200,
 * logged "succeeded" and the empty answer reached the client with no fallback.
 */

const enc = new TextEncoder();
const sse = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n\n`;
const chat = (delta: Record<string, unknown>, finish: string | null = null): string =>
  sse({ choices: [{ index: 0, delta, finish_reason: finish }] });

function streamOf(frames: string[], opts: { hang?: boolean } = {}): Response {
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < frames.length) controller.enqueue(enc.encode(frames[i++]));
      else if (!opts.hang) controller.close();
      else return new Promise(() => {});
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("inspectSSELine", () => {
  it("OpenAI chat: text and tool calls are content, a bare role frame is not", () => {
    expect(inspectSSELine(chat({ role: "assistant" }).trim()).content).toBe(false);
    expect(inspectSSELine(chat({ content: "hi" }).trim()).content).toBe(true);
    expect(inspectSSELine(chat({ content: "" }).trim()).content).toBe(false);
    expect(inspectSSELine(chat({ tool_calls: [{ index: 0, function: { name: "f" } }] }).trim()).content).toBe(true);
    expect(inspectSSELine(chat({}, "stop").trim())).toEqual({ content: false, finishReason: "stop" });
  });

  it("OpenAI chat: reasoning counts as alive so the client keeps seeing the model think", () => {
    expect(inspectSSELine(chat({ reasoning_content: "hmm" }).trim()).content).toBe(true);
  });

  it("Claude: text, tool_use and thinking are content; a refusal maps to content_filter", () => {
    expect(inspectSSELine(sse({ type: "content_block_delta", delta: { type: "text_delta", text: "x" } }).trim()).content).toBe(true);
    expect(inspectSSELine(sse({ type: "content_block_start", content_block: { type: "tool_use", name: "f" } }).trim()).content).toBe(true);
    expect(inspectSSELine(sse({ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "t" } }).trim()).content).toBe(true);
    expect(inspectSSELine(sse({ type: "content_block_start", content_block: { type: "text", text: "" } }).trim()).content).toBe(false);
    expect(inspectSSELine(sse({ type: "message_delta", delta: { stop_reason: "refusal" } }).trim()).finishReason).toBe("content_filter");
    expect(inspectSSELine(sse({ type: "message_delta", delta: { stop_reason: "end_turn" } }).trim()).finishReason).toBe("stop");
  });

  it("Responses: output text, function calls and reasoning are content; terminal events give the finish", () => {
    expect(inspectSSELine(sse({ type: "response.output_text.delta", delta: "hi" }).trim()).content).toBe(true);
    expect(inspectSSELine(sse({ type: "response.output_item.added", item: { type: "function_call" } }).trim()).content).toBe(true);
    expect(inspectSSELine(sse({ type: "response.output_item.added", item: { type: "message" } }).trim()).content).toBe(false);
    expect(inspectSSELine(sse({ type: "response.reasoning_summary_text.delta", delta: "t" }).trim()).content).toBe(true);
    expect(inspectSSELine(sse({ type: "response.completed", response: {} }).trim()).finishReason).toBe("stop");
    expect(inspectSSELine(sse({ type: "response.incomplete", response: { incomplete_details: { reason: "content_filter" } } }).trim()).finishReason).toBe("content_filter");
    expect(inspectSSELine(sse({ type: "response.failed", response: {} }).trim()).finishReason).toBe("failed");
  });

  it("a dialect it does not know is treated as content, never as empty", () => {
    expect(inspectSSELine(sse({ candidates: [{ content: { parts: [{ text: "hi" }] } }] }).trim()).content).toBe(true);
    expect(inspectSSELine(sse({ something: "else" }).trim()).content).toBe(true);
  });

  it("comments, blank lines and [DONE] carry nothing", () => {
    expect(inspectSSELine(": keep-alive")).toEqual({ content: false, finishReason: null });
    expect(inspectSSELine("")).toEqual({ content: false, finishReason: null });
    expect(inspectSSELine("data: [DONE]")).toEqual({ content: false, finishReason: null });
  });
});

describe("isNoRetryFinish", () => {
  it("is true for a refusal that every candidate would repeat", () => {
    for (const r of ["content_filter", "SAFETY", "recitation", "blocklist", "prohibited_content"]) expect(isNoRetryFinish(r)).toBe(true);
    expect(isNoRetryFinish("stop")).toBe(false);
    expect(isNoRetryFinish(null)).toBe(false);
  });
});

describe("isZeroContentResponse", () => {
  it("OpenAI: an empty message that did not finish normally is zero content", () => {
    expect(isZeroContentResponse({ choices: [] })).toBe(true);
    expect(isZeroContentResponse({ choices: [{ message: { content: "" }, finish_reason: null }] })).toBe(true);
    expect(isZeroContentResponse({ choices: [{ message: { content: "" }, finish_reason: "incomplete" }] })).toBe(true);
  });

  it("OpenAI: text, tool calls, reasoning, or a normal finish are not zero content", () => {
    expect(isZeroContentResponse({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }] })).toBe(false);
    expect(isZeroContentResponse({ choices: [{ message: { tool_calls: [{}] }, finish_reason: "tool_calls" }] })).toBe(false);
    expect(isZeroContentResponse({ choices: [{ message: { content: "", reasoning_content: "t" }, finish_reason: null }] })).toBe(false);
    expect(isZeroContentResponse({ choices: [{ message: { content: "" }, finish_reason: "stop" }] })).toBe(false);
  });

  it("Claude: no text or tool_use and no stop reason is zero content", () => {
    expect(isZeroContentResponse({ content: [], stop_reason: null })).toBe(true);
    expect(isZeroContentResponse({ content: [{ type: "text", text: "x" }], stop_reason: "end_turn" })).toBe(false);
    expect(isZeroContentResponse({ content: [{ type: "tool_use" }] })).toBe(false);
  });

  it("anything else is left alone", () => {
    expect(isZeroContentResponse(null)).toBe(false);
    expect(isZeroContentResponse({ output: [] })).toBe(false);
  });
});

describe("peekForContent", () => {
  it("returns null for a response that is not an event stream", async () => {
    expect(await peekForContent(new Response("{}", { headers: { "content-type": "application/json" } }), 1000)).toBeNull();
  });

  it("reports content as soon as a content frame arrives and replays every byte", async () => {
    const frames = [chat({ role: "assistant" }), chat({ content: "he" }), chat({ content: "llo" }), chat({}, "stop"), "data: [DONE]\n\n"];

    const peeked = await peekForContent(streamOf(frames), 1000);

    expect(peeked?.outcome).toBe("content");
    expect(await peeked!.response.text()).toBe(frames.join(""));
  });

  it("reports empty when the stream ends without any content, with its finish reason", async () => {
    const frames = [chat({ role: "assistant" }), chat({}, "stop"), "data: [DONE]\n\n"];

    const peeked = await peekForContent(streamOf(frames), 1000);

    expect(peeked?.outcome).toBe("empty");
    expect(peeked?.finishReason).toBe("stop");
  });

  it("fails open when the deadline passes with nothing decided, without losing the late chunk", async () => {
    let release: (() => void) | undefined;
    const late = new Promise<void>((resolve) => { release = resolve; });
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (sent === 0) { sent++; controller.enqueue(enc.encode(chat({ role: "assistant" }))); return; }
        if (sent === 1) { sent++; await late; controller.enqueue(enc.encode(chat({ content: "late" }))); return; }
        controller.close();
      },
    });

    const peeked = await peekForContent(new Response(body, { headers: { "content-type": "text/event-stream" } }), 25);
    expect(peeked?.outcome).toBe("content");
    release?.();

    expect(await peeked!.response.text()).toBe(chat({ role: "assistant" }) + chat({ content: "late" }));
  });

  it("surfaces an upstream error through the replay instead of swallowing it", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(enc.encode(chat({ role: "assistant" }))); controller.error(new Error("reset")); },
    });

    const peeked = await peekForContent(new Response(body, { headers: { "content-type": "text/event-stream" } }), 1000);

    await expect(peeked!.response.text()).rejects.toThrow("reset");
  });
});

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function chatJson(content: string, finish: string | null = "stop"): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content }, finish_reason: finish }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function runCombo(models: string[], answers: Record<string, () => Response>): Promise<{ response: Response; tried: string[] }> {
  const tried: string[] = [];
  const response = await handleComboChat({
    body: { stream: false },
    models,
    handleSingleModel: async (_body: Record<string, unknown>, modelStr: string): Promise<Response> => {
      tried.push(modelStr);
      return answers[modelStr]();
    },
    log,
    comboName: "t",
    autoSwitch: false,
  });
  return { response, tried };
}

describe("combo falls through a 200 with no content", () => {
  it("moves to the next member for an empty JSON answer", async () => {
    const { response, tried } = await runCombo(["a/m", "b/m"], {
      "a/m": () => chatJson("", null),
      "b/m": () => chatJson("real answer"),
    });

    expect(tried).toEqual(["a/m", "b/m"]);
    expect(JSON.stringify(await response.json())).toContain("real answer");
  });

  it("moves to the next member for a stream that ends empty", async () => {
    const { response, tried } = await runCombo(["a/m", "b/m"], {
      "a/m": () => streamOf([chat({ role: "assistant" }), chat({}, "stop"), "data: [DONE]\n\n"]),
      "b/m": () => streamOf([chat({ content: "real answer" }), "data: [DONE]\n\n"]),
    });

    expect(tried).toEqual(["a/m", "b/m"]);
    expect(await response.text()).toContain("real answer");
  });

  it("serves a stream that has content without waiting for it to end", async () => {
    const { response, tried } = await runCombo(["a/m", "b/m"], {
      "a/m": () => streamOf([chat({ content: "first" })], { hang: true }),
      "b/m": () => streamOf([chat({ content: "never" })]),
    });

    expect(tried).toEqual(["a/m"]);
    const reader = response.body!.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain("first");
    await reader.cancel();
  });

  it("returns the last member's answer as it is, even when empty", async () => {
    const { response, tried } = await runCombo(["a/m", "b/m"], {
      "a/m": () => chatJson("", null),
      "b/m": () => chatJson("", null),
    });

    expect(tried).toEqual(["a/m", "b/m"]);
    expect(response.status).toBe(200);
  });

  it("does not retry a refusal every member would repeat", async () => {
    const { response, tried } = await runCombo(["a/m", "b/m"], {
      "a/m": () => streamOf([chat({ role: "assistant" }), chat({}, "content_filter"), "data: [DONE]\n\n"]),
      "b/m": () => streamOf([chat({ content: "never" })]),
    });

    expect(tried).toEqual(["a/m"]);
    expect(await response.text()).toContain("content_filter");
  });

  it("an empty normal answer (finish stop) is the model's answer, not a failure", async () => {
    const { tried } = await runCombo(["a/m", "b/m"], {
      "a/m": () => chatJson("", "stop"),
      "b/m": () => chatJson("other"),
    });

    expect(tried).toEqual(["a/m"]);
  });
});

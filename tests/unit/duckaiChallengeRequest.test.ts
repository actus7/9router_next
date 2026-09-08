import { describe, expect, it, vi } from "vitest";

import { DUCKAI_USER_AGENT } from "@/server/llm-gateway/engine/executors/duckaiChallengeTypes";
import {
  getReasoningEffort,
  sendDuckAiChatRequest,
} from "@/server/llm-gateway/engine/executors/duckaiRequest";
import { STATUS_HEADERS } from "@/server/llm-gateway/engine/executors/duckaiRuntime";

function decodeBase64Json(value: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(value, "base64").toString("utf-8"));
}

async function captureChatRequest() {
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("", { status: 200 }));

  try {
    await sendDuckAiChatRequest({
      cookies: "",
      durableStream: {
        conversationId: "c",
        messageId: "m",
        publicKey: {} as JsonWebKey,
      },
      messages: [{ role: "user", content: "say OK" }],
      modelId: "gpt-5.6-luna",
      reasoningEffort: getReasoningEffort("gpt-5.6-luna"),
      vqdData: {
        browserFallbackUsed: true,
        cookies: "",
        hashPayload: "hash",
        jsdomAttempts: 0,
      },
    });

    const init = fetchSpy.mock.calls[0]?.[1];
    return {
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    };
  } finally {
    fetchSpy.mockRestore();
  }
}

describe("Duck.ai chat request", () => {
  it("sends an interaction trace in x-fe-signals — an empty one is rejected with 418", async () => {
    const { headers } = await captureChatRequest();

    const signals = decodeBase64Json(headers["x-fe-signals"]);
    const events = signals.events as Array<Record<string, unknown>>;

    expect(events.length).toBeGreaterThan(0);
    // The upstream only accepts the trace when a trusted user action is in it.
    expect(events.some((e) => e.name === "action" && e.trusted === true)).toBe(true);
    // A sub-second window reads as "no human composed this message".
    expect(Number(signals.end)).toBeGreaterThan(1000);
    expect(headers["x-ddg-journey-id"]).toMatch(/^[0-9a-f]{32}$/);
  });

  it("sends the same User-Agent the challenge hashed, so the hash still validates", async () => {
    const { headers } = await captureChatRequest();

    expect(headers["User-Agent"]).toBe(DUCKAI_USER_AGENT);
    // One definition only: a second copy drifting out of sync is what broke this.
    expect(STATUS_HEADERS["User-Agent"]).toBe(DUCKAI_USER_AGENT);
  });

  it("sends an explicit reasoningEffort for models that require one", async () => {
    const { body } = await captureChatRequest();

    // Omitting it makes gpt-5.6-* fail with 400 ERR_BAD_REQUEST.
    expect(body.reasoningEffort).toBe("none");
  });

  it("maps each free model to an effort it actually accepts", () => {
    // gpt-oss declares "low" as its only supported effort, so the "none" that
    // works everywhere else earns a 400 there.
    expect(getReasoningEffort("tinfoil/gpt-oss-120b")).toBe("low");

    for (const model of [
      "gpt-5.6-luna",
      "gpt-5.4-mini",
      "claude-haiku-4-5",
      "tinfoil/gemma4-31b",
    ]) {
      expect(getReasoningEffort(model)).toBe("none");
    }

    // A general (non-reasoning) model must be sent no effort at all.
    expect(getReasoningEffort("mistral-small-2603")).toBeUndefined();
  });

  it("keeps the registry's model ids in step with the effort map", async () => {
    const registry = (await import("@/server/llm-gateway/engine/providers/registry/duckai"))
      .default as { models: Array<{ id: string }> };

    // Every reasoning id the effort map knows about has to be offered, and every
    // offered id has to be one the upstream still answers 200 for.
    for (const id of ["gpt-5.6-luna", "tinfoil/gpt-oss-120b", "mistral-small-2603"]) {
      expect(registry.models.map((m) => m.id)).toContain(id);
    }
    // Tier-gated ids answer 404 without a subscription: they must stay out.
    for (const id of ["gpt-5.6-sol", "gpt-5.6-terra", "claude-opus-4-8", "claude-sonnet-4-6"]) {
      expect(registry.models.map((m) => m.id)).not.toContain(id);
    }
  });
});

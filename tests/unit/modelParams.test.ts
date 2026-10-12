import { describe, expect, it } from "vitest";
import {
  applyConfiguredEntryParams,
  applyEntryParams,
  paramSpecFor,
  resolveParamModelId,
  sanitizeEntryParams,
} from "@/server/llm-gateway/engine/services/modelParams";

/**
 * The generic per-model parameter layer, over the real modelparams catalog:
 * which knobs a model accepts, which values are valid, and how a lane entry's
 * configured values are merged into the outbound request.
 */
describe("resolveParamModelId", () => {
  it("resolves a bare upstream model id", () => {
    expect(resolveParamModelId("gpt-5.5")).toBe("openai/gpt-5.5");
  });

  it("picks the model's own vendor when several resellers list it", () => {
    expect(resolveParamModelId("glm-5.3")).toBe("z-ai/glm-5.3");
  });

  it("uses the subscription variant for a subscription connection when the catalog has one", () => {
    expect(resolveParamModelId("gpt-5.6-sol", { subscription: true })).toBe("openai/gpt-5.6-sol-subscription");
    expect(resolveParamModelId("gpt-5.6-sol")).toBe("openai/gpt-5.6-sol");
  });

  it("returns null for a model the catalog does not know", () => {
    expect(resolveParamModelId("space-bunny-free")).toBeNull();
    expect(resolveParamModelId("auto")).toBeNull();
  });
});

describe("paramSpecFor", () => {
  it("lists the parameters the model accepts, with paths and groups", () => {
    const spec = paramSpecFor("glm-5.3");
    expect(spec?.id).toBe("z-ai/glm-5.3");
    expect(spec?.params.map((p) => p.path)).toEqual(expect.arrayContaining(["max_tokens", "temperature"]));
  });

  it("is null when there is nothing to configure", () => {
    expect(paramSpecFor("space-bunny-free")).toBeNull();
  });
});

describe("sanitizeEntryParams", () => {
  it("accepts values the catalog allows", () => {
    const result = sanitizeEntryParams("z-ai/glm-5.3", { temperature: 0.5 });
    expect(result).toEqual({ ok: true, value: { temperature: 0.5 } });
  });

  it("rejects an out-of-range value and an unknown parameter instead of ignoring them", () => {
    expect(sanitizeEntryParams("z-ai/glm-5.3", { temperature: 99 }).ok).toBe(false);
    expect(sanitizeEntryParams("z-ai/glm-5.3", { not_a_param: 1 }).ok).toBe(false);
  });
});

describe("applyEntryParams", () => {
  it("lets a configured value win over the client's and keeps the rest of the body", () => {
    const body = { model: "x", temperature: 1, messages: [{ role: "user", content: "hi" }] };
    const out = applyEntryParams(body, "z-ai/glm-5.3", { temperature: 0.2 });
    expect(out.temperature).toBe(0.2);
    expect(out.messages).toEqual(body.messages);
    expect(body.temperature).toBe(1); // input untouched
  });

  it("writes dotted paths as nested request fields", () => {
    const out = applyEntryParams({ model: "x" }, "z-ai/glm-5.3", { "thinking.type": "enabled" });
    expect((out as { thinking?: { type?: string } }).thinking?.type).toBe("enabled");
  });

  it("drops a client parameter the configured values make inapplicable", () => {
    // Anthropic rejects top_p unless temperature is 1.
    const out = applyEntryParams<Record<string, unknown>>({ model: "x", top_p: 0.9 }, "anthropic/claude-3-opus-20240229", { temperature: 0.5 });
    expect(out.temperature).toBe(0.5);
    expect(out).not.toHaveProperty("top_p");
  });

  it("is a no-op without configured values", () => {
    const body = { model: "x", temperature: 1 };
    expect(applyEntryParams(body, "z-ai/glm-5.3", undefined)).toEqual(body);
  });
});

describe("applyConfiguredEntryParams and the wire shape", () => {
  it("applies when the target format is the catalog entry's API surface", () => {
    const out = applyConfiguredEntryParams<Record<string, unknown>>({ model: "x" }, "glm-5.3", { temperature: 0.2 }, "apikey", "openai");
    expect(out.temperature).toBe(0.2);
  });

  it("leaves a body in another shape untouched instead of adding fields it would not understand", () => {
    const body = { contents: [] };
    expect(applyConfiguredEntryParams(body, "glm-5.3", { temperature: 0.2 }, "apikey", "gemini")).toBe(body);
  });

  it("uses the Responses variant on a Codex target for an OAuth connection", () => {
    const out = applyConfiguredEntryParams<Record<string, unknown>>({ model: "x" }, "gpt-5.6-terra", { "reasoning.effort": "xhigh" }, "oauth", "codex");
    expect((out.reasoning as { effort?: string }).effort).toBe("xhigh");
  });
});

describe("the spec follows the provider's wire shape", () => {
  it("offers nothing when the only catalog variants are in another shape than the target", () => {
    // gpt-6.1-sol exists only as an OpenAI-chat entry; a Codex (Responses) target cannot use it.
    expect(paramSpecFor("gpt-6.1-sol", { subscription: true, targetFormat: "codex" })).toBeNull();
    expect(paramSpecFor("gpt-6.1-sol", { targetFormat: "openai" })).not.toBeNull();
  });

  it("switches to the variant that matches the target", () => {
    expect(paramSpecFor("gpt-5.6-terra", { subscription: true, targetFormat: "codex" })?.id).toBe("openai/gpt-5.6-terra-subscription");
    expect(paramSpecFor("gpt-5.6-terra", { targetFormat: "codex" })?.id).toBe("openai/gpt-5.6-terra-subscription");
  });
});

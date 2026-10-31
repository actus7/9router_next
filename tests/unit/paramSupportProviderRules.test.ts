import { describe, expect, it } from "vitest";

import { stripUnsupportedParams } from "@/server/llm-gateway/engine/translator/concerns/paramSupport";
import { DefaultExecutor } from "@/server/llm-gateway/engine/executors/default";

const RESPONSE_FORMAT = { type: "json_schema", json_schema: { name: "t", schema: { type: "object" } } };

describe("stripUnsupportedParams: openai max_tokens rename", () => {
  it("renames max_tokens to max_completion_tokens for the openai provider", () => {
    const body: Record<string, unknown> = { max_tokens: 50, temperature: 1 };

    stripUnsupportedParams("openai", "gpt-6-luna", body);

    expect(body).toEqual({ max_completion_tokens: 50, temperature: 1 });
  });

  it("keeps an explicit max_completion_tokens when both are sent to openai", () => {
    const body: Record<string, unknown> = { max_tokens: 50, max_completion_tokens: 80 };

    stripUnsupportedParams("openai", "gpt-5.5", body);

    expect(body).toEqual({ max_completion_tokens: 80 });
  });

  it("leaves max_tokens untouched for other providers", () => {
    const body: Record<string, unknown> = { max_tokens: 50 };

    stripUnsupportedParams("groq", "qwen/qwen3.6-27b", body);

    expect(body).toEqual({ max_tokens: 50 });
  });

  it("applies through the default executor used by the openai provider", () => {
    const transformed = new DefaultExecutor("openai").transformRequest("gpt-5.5", { max_tokens: 64 }, false, {});

    expect(transformed).toMatchObject({ max_completion_tokens: 64 });
    expect(transformed).not.toHaveProperty("max_tokens");
  });
});

describe("stripUnsupportedParams: opencode-go deepseek response_format", () => {
  it("drops response_format for opencode-go deepseek models", () => {
    for (const model of ["deepseek-v4.1-flash", "deepseek-v4-pro"]) {
      const body: Record<string, unknown> = { messages: [{ role: "user", content: "hi" }], response_format: RESPONSE_FORMAT };

      stripUnsupportedParams("opencode-go", model, body);

      expect(body).not.toHaveProperty("response_format");
    }
  });

  it("keeps response_format for opencode-go models that serve it", () => {
    const body: Record<string, unknown> = { messages: [], response_format: RESPONSE_FORMAT };

    stripUnsupportedParams("opencode-go", "glm-5.3", body);

    expect(body.response_format).toBe(RESPONSE_FORMAT);
  });

  it("keeps response_format for other providers fronting deepseek ids", () => {
    const body: Record<string, unknown> = { messages: [], response_format: RESPONSE_FORMAT };

    stripUnsupportedParams("openrouter", "deepseek/deepseek-v3.2", body);

    expect(body.response_format).toBe(RESPONSE_FORMAT);
  });
});

describe("stripUnsupportedParams: cloudflare-ai image content", () => {
  const content = [
    { type: "text", text: "Describe this image" },
    { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } },
  ];

  it("preserves image_url parts for a vision-capable model", () => {
    const body: Record<string, unknown> = { messages: [{ role: "user", content }] };

    stripUnsupportedParams("cloudflare-ai", "@cf/google/gemma-3-12b-it", body);

    expect((body.messages as Record<string, unknown>[])[0].content).toEqual(content);
  });

  it("still flattens content for a model without vision", () => {
    const body: Record<string, unknown> = { messages: [{ role: "user", content }] };

    stripUnsupportedParams("cloudflare-ai", "@cf/meta/llama-3.2-1b-instruct", body);

    expect((body.messages as Record<string, unknown>[])[0].content).toBe("Describe this image");
  });

  it("still flattens text-only content for a vision-capable model", () => {
    const body: Record<string, unknown> = {
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }, { type: "text", text: " world" }] }],
    };

    stripUnsupportedParams("cloudflare-ai", "@cf/google/gemma-3-12b-it", body);

    expect((body.messages as Record<string, unknown>[])[0].content).toBe("hello world");
  });
});

describe("stripUnsupportedParams: groq reasoning_effort clamp", () => {
  const clamp = (effort: string) => {
    const body: Record<string, unknown> = { reasoning_effort: effort };
    stripUnsupportedParams("groq", "openai/gpt-oss-120b", body);
    return body.reasoning_effort;
  };

  it("maps none and minimal to low, xhigh and max to high", () => {
    expect(clamp("none")).toBe("low");
    expect(clamp("minimal")).toBe("low");
    expect(clamp("xhigh")).toBe("high");
    expect(clamp("max")).toBe("high");
  });

  it("leaves Groq's Qwen alone: it takes none/default, which the clamp would turn into a 400", () => {
    const body: Record<string, unknown> = { reasoning_effort: "none" };
    stripUnsupportedParams("groq", "qwen/qwen3-32b", body);
    expect(body.reasoning_effort).toBe("none");
  });

  it("keeps values Groq already accepts", () => {
    expect(clamp("low")).toBe("low");
    expect(clamp("medium")).toBe("medium");
    expect(clamp("high")).toBe("high");
  });

  it("does not clamp reasoning_effort for other providers", () => {
    const body: Record<string, unknown> = { reasoning_effort: "none" };

    stripUnsupportedParams("cerebras", "gpt-oss-120b", body);

    expect(body.reasoning_effort).toBe("none");
  });
});

describe("stripUnsupportedParams: nvidia reasoning alias", () => {
  it("renames assistant reasoning to reasoning_content and keeps an existing canonical value", () => {
    const body: Record<string, unknown> = {
      messages: [
        { role: "assistant", content: "", reasoning: "alias", reasoning_content: "canonical" },
        { role: "assistant", content: "", reasoning: "alias only" },
        { role: "user", content: "hi", reasoning: "not an assistant turn" },
      ],
    };

    stripUnsupportedParams("nvidia", "deepseek-ai/deepseek-v4-pro", body);

    expect(body.messages).toEqual([
      { role: "assistant", content: "", reasoning_content: "canonical" },
      { role: "assistant", content: "", reasoning_content: "alias only" },
      { role: "user", content: "hi", reasoning: "not an assistant turn" },
    ]);
  });

  it("does not rename reasoning for other providers", () => {
    const body: Record<string, unknown> = { messages: [{ role: "assistant", content: "", reasoning: "x" }] };

    stripUnsupportedParams("openrouter", "deepseek/deepseek-v3.2", body);

    expect(body.messages).toEqual([{ role: "assistant", content: "", reasoning: "x" }]);
  });
});

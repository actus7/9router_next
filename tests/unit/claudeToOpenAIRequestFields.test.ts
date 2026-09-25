import { describe, it, expect } from "vitest";
import { claudeToOpenAIRequest } from "@/server/llm-gateway/engine/translator/request/claude-to-openai";

// Campos da Messages API que sumiam no caminho para um upstream OpenAI.

const IMG = { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" };

describe("claude → openai: campos da requisição", () => {
  it("stop_sequences, top_p, tool_choice none e disable_parallel_tool_use chegam ao upstream", () => {
    const out = claudeToOpenAIRequest("m", {
      max_tokens: 100,
      stop_sequences: ["END"],
      top_p: 0.9,
      messages: [{ role: "user", content: "oi" }],
      tools: [{ name: "t", input_schema: { type: "object" } }],
      tool_choice: { type: "none" },
    }, false);
    expect(out.stop).toEqual(["END"]);
    expect(out.top_p).toBe(0.9);
    expect(out.tool_choice).toBe("none");

    const par = claudeToOpenAIRequest("m", {
      max_tokens: 100,
      messages: [{ role: "user", content: "oi" }],
      tools: [{ name: "t", input_schema: { type: "object" } }],
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
    }, false);
    expect(par.parallel_tool_calls).toBe(false);
  });

  it("imagem por URL vira image_url", () => {
    const out = claudeToOpenAIRequest("m", {
      max_tokens: 100,
      messages: [{ role: "user", content: [
        { type: "text", text: "o que é isto?" },
        { type: "image", source: { type: "url", url: "https://x.test/a.png" } },
      ] }],
    }, false);
    const content = out.messages[0].content as Array<Record<string, unknown>>;
    expect(content[1]).toEqual({ type: "image_url", image_url: { url: "https://x.test/a.png" } });
  });

  it("tool_result só com imagem não vira base64 em texto; a imagem segue como parte de imagem", () => {
    const out = claudeToOpenAIRequest("m", {
      max_tokens: 100,
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "tu1", name: "screenshot", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: [{ type: "image", source: IMG }] }] },
      ],
    }, false);
    const tool = out.messages.find((m) => m.role === "tool")!;
    expect(String(tool.content)).not.toContain(IMG.data);
    const user = out.messages.find((m) => m.role === "user")!;
    expect(JSON.stringify(user.content)).toContain("data:image/png;base64,");
  });

  it("tool_result com is_error é marcado como erro para o modelo", () => {
    const out = claudeToOpenAIRequest("m", {
      max_tokens: 100,
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "tu1", name: "t", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", is_error: true, content: "ENOENT" }] },
      ],
    }, false);
    expect(String(out.messages.find((m) => m.role === "tool")!.content)).toMatch(/error/i);
  });
});

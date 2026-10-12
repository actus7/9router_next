import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prepareTranslatedBody } from "@/server/llm-gateway/engine/handlers/chatCore/phases";
import { setEntryConfig } from "@/server/llm-gateway/engine/host/entryConfig";

async function prepare(provider: string, targetFormat: string, upstreamModel: string, params: Record<string, string | number | boolean>, authType: string) {
  const body: Record<string, unknown> = { model: "x", temperature: 1, messages: [{ role: "user", content: "hi" }] };
  setEntryConfig(body, { params });
  const result = await prepareTranslatedBody({
    body, sourceFormat: "openai", targetFormat, upstreamModel, stripList: [],
    credentials: { authType } as never, provider, model: upstreamModel, stream: false, connectionId: "c1", clientTool: null, reqLogger: null,
  });
  if ("error" in result && result.error) throw new Error("translation failed");
  return (result as { translatedBody: Record<string, unknown> }).translatedBody;
}

describe("entry params through the real translator", () => {
  it("openai-chat target: the configured value wins over the client's and the rest stays", async () => {
    const out = await prepare("zai", "openai", "glm-5.3", { temperature: 0.2, reasoning_effort: "max" }, "apikey");
    expect(out.temperature).toBe(0.2);
    expect(out.reasoning_effort).toBe("max");
    expect(out.messages).toBeDefined();
  });

  it("codex target: the Responses-shaped effort lands in `reasoning.effort`", async () => {
    const out = await prepare("codex", "codex", "gpt-5.6-terra", { "reasoning.effort": "xhigh" }, "oauth");
    expect((out.reasoning as { effort?: string } | undefined)?.effort).toBe("xhigh");
  });

  it("a Gemini-shaped target is left exactly as translated", async () => {
    const out = await prepare("gemini", "gemini", "glm-5.3", { temperature: 0.2 }, "apikey");
    expect(out).not.toHaveProperty("temperature");
  });
});

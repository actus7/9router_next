import { handleSingleModelChat } from "./chat";
import type { LlmRoutingClassification } from "@/server/llm-gateway/engine/services/smart-routing/router";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function extractText(payload: unknown): string {
  const root = asRecord(payload);
  const choice = Array.isArray(root.choices) ? asRecord(root.choices[0]) : {};
  const message = asRecord(choice.message);
  if (typeof message.content === "string") return message.content;
  const content = Array.isArray(root.content) ? asRecord(root.content[0]) : {};
  if (typeof content.text === "string") return content.text;
  if (Array.isArray(root.output)) {
    for (const item of root.output) {
      const blocks = asRecord(item).content;
      if (!Array.isArray(blocks)) continue;
      const block = blocks.map(asRecord).find((candidate) => typeof candidate.text === "string");
      if (typeof block?.text === "string") return block.text;
    }
  }
  return typeof root.response === "string" ? root.response : "";
}

export async function classifySmartRouting(
  model: string,
  prompt: string,
  timeoutMs: number,
  request: Request,
  apiKey: string | null = null,
): Promise<LlmRoutingClassification | null> {
  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 120,
    stream: false,
  };
  const response = await Promise.race([
    handleSingleModelChat(body, model, {
      endpoint: "/v1/chat/completions",
      body,
      headers: { accept: "application/json", "x-router-internal": "classifier" },
    }, request, apiKey),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
  if (!response || !response.ok) return null;
  const text = extractText(await response.json());
  if (typeof text !== "string" || !text.trim()) return null;
  try {
    const value = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""));
    if (!value || !["simple", "standard", "complex", "reasoning"].includes(value.tier)) return null;
    return { tier: value.tier, need: value.need } as LlmRoutingClassification;
  } catch {
    return null;
  }
}

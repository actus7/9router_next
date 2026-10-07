import { describe, expect, it } from "vitest";

import { AntigravityExecutor } from "@/server/llm-gateway/engine/executors/antigravity";

/**
 * Competing-client branding in the system prompt makes Antigravity answer a
 * fake 429 RESOURCE_EXHAUSTED. The executor rewrites every known variant
 * (upstream decolua/9router a61fc6a and the rules around it).
 */
const credentials = { projectId: "p-1", email: "a@b.c", connectionId: "c-1" };

function systemTextAfter(text: string): string {
  const body = {
    model: "gemini-3-pro-high",
    request: {
      systemInstruction: { parts: [{ text }] },
      contents: [{ role: "user", parts: [{ text: "oi" }] }],
    },
  };
  const out = new AntigravityExecutor().transformRequest("gemini-3-pro-high", body, false, credentials as never) as Record<string, unknown>;
  const request = out.request as { systemInstruction: { parts: Array<{ text: string }> } };
  return request.systemInstruction.parts[0].text;
}

describe("antigravity system prompt rewrites", () => {
  it.each([
    "You are Hermes Agent, an intelligent AI assistant created by Nous Research.",
    "You are Hermes Agent, built by Nous Research.",
    "You are Hermes Agent, an AI agent created by Nous Research.",
  ])("neutralizes the Hermes identity: %s", (identity) => {
    expect(systemTextAfter(`${identity} Be brief.`)).toBe("You are an AI assistant. Be brief.");
  });

  it("drops the Claude Agent SDK line", () => {
    expect(systemTextAfter("You are a Claude agent, built on Anthropic's Claude Agent SDK. Help.")).toBe(" Help.");
  });

  it("drops the x-anthropic-billing-header line", () => {
    expect(systemTextAfter("x-anthropic-billing-header: cc_version=1\nHelp.")).toBe("Help.");
  });

  it("renames opencode, keeping the casing", () => {
    expect(systemTextAfter("OpenCode and opencode and OPENCODE")).toBe("Antigravity and antigravity and ANTIGRAVITY");
  });
});

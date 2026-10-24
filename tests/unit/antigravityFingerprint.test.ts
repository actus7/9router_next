import { describe, expect, it } from "vitest";

import { ANTIGRAVITY_IDE_USER_AGENT, ANTIGRAVITY_IDE_VERSION } from "@/server/llm-gateway/engine/providers/shared";
import antigravity from "@/server/llm-gateway/engine/providers/registry/antigravity";

// The provider profile has to match the client Google currently serves. A stale IDE
// fingerprint answered 404 for Gemini 4 Argon; the Hub desktop client is what current
// models are reached through.
describe("Antigravity client fingerprint", () => {
  it("presents the Hub desktop client at a current version", () => {
    expect(ANTIGRAVITY_IDE_VERSION).toBe("2.24.0");
    expect(ANTIGRAVITY_IDE_USER_AGENT).toBe("antigravity/hub/2.24.0 darwin/arm64");
  });
});

describe("Antigravity Gemini 4 Argon tiers", () => {
  const overrides = (antigravity as unknown as { modelOverrides: Record<string, { upstreamModelId?: string }> }).modelOverrides;

  it.each(["high", "medium", "low"])("maps the %s tier to its upstream id", (tier) => {
    expect(overrides[`gemini-4-argon-${tier}`]?.upstreamModelId).toBe(`gemini-4-argon-${tier}(${tier})`);
  });
});

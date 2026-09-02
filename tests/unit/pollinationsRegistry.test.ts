import { describe, expect, it } from "vitest";

import pollinations from "@/server/llm-gateway/engine/providers/registry/pollinations";

describe("Pollinations registry", () => {
  it("requires a real API key for chat completions", () => {
    expect("noAuth" in pollinations).toBe(false);
    expect(pollinations.authType).toBe("apikey");
    expect(pollinations.display.notice).toMatchObject({ apiKeyUrl: "https://enter.pollinations.ai" });
  });
});

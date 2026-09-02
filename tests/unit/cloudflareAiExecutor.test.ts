import { describe, expect, it } from "vitest";

import { CloudflareAIExecutor } from "@/server/llm-gateway/engine/executors/cloudflare-ai";

describe("CloudflareAIExecutor", () => {
  it("preserves the extended connection grace for GLM 4.7 Flash", () => {
    const executor = new CloudflareAIExecutor();

    expect(executor.getTimeoutMs("@cf/zai-org/glm-4.7-flash")).toBe(200_000);
    expect(executor.getTimeoutMs("@cf/meta/llama-3.2-1b-instruct")).toBe(60_000);
  });
});

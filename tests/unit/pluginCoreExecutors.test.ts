import { afterEach, describe, expect, it } from "vitest";
import { bootstrap, resetContext } from "@/server/plugin-core/context";
import { executors } from "@/server/llm-gateway/engine/executors";

describe("executors plugin", () => {
  afterEach(async () => {
    await resetContext();
  });

  it("registers ctx.executors with every specialized executor name", async () => {
    const ctx = await bootstrap();
    for (const name of Object.keys(executors)) {
      expect(ctx.executors.has(name)).toBe(true);
    }
  });

  it("falls back to a cached DefaultExecutor for an unknown provider", async () => {
    const ctx = await bootstrap();
    expect(ctx.executors.has("totally-unknown-provider")).toBe(false);
    const executor = ctx.executors.get("totally-unknown-provider");
    expect(executor).toBeTruthy();
    expect(ctx.executors.get("totally-unknown-provider")).toBe(executor);
  });
});

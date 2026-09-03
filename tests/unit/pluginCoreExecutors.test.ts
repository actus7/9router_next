import { afterEach, describe, expect, it } from "vitest";
import { bootstrap, resetContext } from "@/server/plugin-core/context";
import {
  executors,
  getExecutor,
  hasSpecializedExecutor,
} from "@/server/llm-gateway/engine/executors";
import { resetPluginRegistry } from "@/server/plugin-core/pluginRegistry";
import { OpenCodeExecutor } from "@/server/llm-gateway/engine/executors/opencode";

describe("executors plugin", () => {
  afterEach(async () => {
    await resetContext();
    resetPluginRegistry();
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

  it("a plugin-registered executor is visible through ctx.executors and the raw (non-Cordis) lookup", async () => {
    const ctx = await bootstrap();
    const pluginExecutor = { execute: async () => ({}) };
    ctx.executors.register("test-plugin-provider", pluginExecutor);

    expect(ctx.executors.get("test-plugin-provider")).toBe(pluginExecutor);
    expect(ctx.executors.has("test-plugin-provider")).toBe(true);
    // The 60+ static executors are used directly via these two exports in
    // chatCore.ts/imageGenerationCore.ts/embeddingsCore.ts — a plugin must be
    // visible there too, without those callers ever touching Cordis.
    expect(getExecutor("test-plugin-provider")).toBe(pluginExecutor);
    expect(hasSpecializedExecutor("test-plugin-provider")).toBe(true);
  });

  it("a plugin executor takes priority over a static executor of the same name", async () => {
    const ctx = await bootstrap();
    const override = { execute: async () => ({}) };
    ctx.executors.register("aihorde", override);
    expect(getExecutor("aihorde")).toBe(override);
  });

  it("opencode resolves through its composed executor row, not a static entry", async () => {
    await bootstrap();
    expect(executors).not.toHaveProperty("opencode");
    expect(getExecutor("opencode")).toBeInstanceOf(OpenCodeExecutor);
    expect(hasSpecializedExecutor("opencode")).toBe(true);
  });

  it("routes OpenCode chat models to the Zen OpenAI-compatible endpoint", async () => {
    await bootstrap();
    const executor = getExecutor("opencode");

    expect(executor).toBeInstanceOf(OpenCodeExecutor);
    expect((executor as OpenCodeExecutor).buildUrl("big-pickle")).toBe(
      "https://opencode.ai/zen/v1/chat/completions",
    );
  });
});

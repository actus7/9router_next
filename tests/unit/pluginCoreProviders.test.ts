import { afterEach, describe, expect, it } from "vitest";
import { bootstrap, resetContext } from "@/server/plugin-core/context";
import providerRegistry from "@/server/llm-gateway/engine/providers/registry";
import { listPluginProviders, resetPluginRegistry } from "@/server/plugin-core/pluginRegistry";

describe("providers plugin", () => {
  afterEach(async () => {
    await resetContext();
    resetPluginRegistry();
  });

  it("registers ctx.providers with every provider id from the registry", async () => {
    const ctx = await bootstrap();
    for (const provider of providerRegistry) {
      expect(
        ctx.providers.getById((provider as { id: string }).id)
      ).toBeTruthy();
    }
    expect(ctx.providers.getAll()).toHaveLength(providerRegistry.length);
  });

  it("returns null for an unknown provider id", async () => {
    const ctx = await bootstrap();
    expect(ctx.providers.getById("does-not-exist")).toBeNull();
  });

  it("a plugin-registered provider is visible through ctx.providers and the shared overlay", async () => {
    const ctx = await bootstrap();
    ctx.providers.register({ id: "test-plugin-provider", name: "Test Plugin Provider" });

    expect(ctx.providers.getById("test-plugin-provider")).toEqual({ id: "test-plugin-provider", name: "Test Plugin Provider" });
    expect(listPluginProviders()).toHaveLength(1);
  });
});

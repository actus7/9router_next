import { afterEach, describe, expect, it } from "vitest";
import { bootstrap, resetContext } from "@/server/plugin-core/context";
import providerRegistry from "@/server/llm-gateway/engine/providers/registry";

describe("providers plugin", () => {
  afterEach(async () => {
    await resetContext();
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
});

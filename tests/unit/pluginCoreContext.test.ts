import { afterEach, describe, expect, it } from "vitest";
import { bootstrap, getContext, resetContext } from "@/server/plugin-core/context";

describe("plugin-core context bootstrap", () => {
  afterEach(async () => {
    await resetContext();
  });

  it("memoizes the root context across calls", async () => {
    const first = await bootstrap();
    const second = await bootstrap();
    expect(second).toBe(first);
  });

  it("throws from getContext() before bootstrap() has run", async () => {
    await resetContext();
    expect(() => getContext()).toThrow();
  });

  it("creates a fresh context after resetContext()", async () => {
    const before = await bootstrap();
    await resetContext();
    const after = await bootstrap();
    expect(after).not.toBe(before);
  });

  it("returns the same context to concurrent callers", async () => {
    const [a, b] = await Promise.all([bootstrap(), bootstrap()]);
    expect(a).toBe(b);
    const singleton = await bootstrap();
    expect(a).toBe(singleton);
  });
});

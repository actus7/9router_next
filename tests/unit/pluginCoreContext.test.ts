import { afterEach, describe, expect, it } from "vitest";
import { bootstrap, getContext, resetContext } from "@/server/plugin-core/context";

describe("plugin-core context bootstrap", () => {
  afterEach(async () => {
    await resetContext();
  });

  it("memoizes the root context across calls", () => {
    const first = bootstrap();
    const second = bootstrap();
    expect(second).toBe(first);
  });

  it("throws from getContext() before bootstrap() has run", async () => {
    await resetContext();
    expect(() => getContext()).toThrow();
  });

  it("creates a fresh context after resetContext()", async () => {
    const before = bootstrap();
    await resetContext();
    const after = bootstrap();
    expect(after).not.toBe(before);
  });
});

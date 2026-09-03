import { describe, expect, it, vi } from "vitest";

const connection = vi.fn();
vi.mock("next/server", () => ({ connection: () => connection() }));

const { assertRequestRuntime } = await import("@/server/application/http/requestRuntime");

/**
 * `connection()` throws for two very different reasons: there is no request scope
 * (harmless in unit tests) and prerendering must be interrupted (must propagate,
 * otherwise the route prerenders with runtime data). Only the first may be swallowed.
 */
describe("assertRequestRuntime", () => {
  it("swallows the missing-request-scope error Next raises outside a request", async () => {
    connection.mockRejectedValueOnce(
      Object.assign(new Error("`connection` was called outside a request scope."), {
        __NEXT_ERROR_CODE: "E251",
      }),
    );
    await expect(assertRequestRuntime()).resolves.toBeUndefined();
  });

  it("propagates prerender-interrupt signals", async () => {
    connection.mockRejectedValueOnce(
      Object.assign(new Error("Route /dashboard needs to bail out of prerendering"), {
        __NEXT_ERROR_CODE: "E394",
      }),
    );
    await expect(assertRequestRuntime()).rejects.toThrow(/bail out of prerendering/);
  });

  it("propagates untagged failures instead of hiding them", async () => {
    connection.mockRejectedValueOnce(new Error("boom"));
    await expect(assertRequestRuntime()).rejects.toThrow("boom");
  });
});

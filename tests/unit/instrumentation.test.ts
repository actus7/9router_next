import { describe, expect, it, vi, afterEach } from "vitest";
import { register, onRequestError } from "@/instrumentation";

describe("instrumentation (FASE 5)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("exports register and onRequestError hooks", () => {
    expect(typeof register).toBe("function");
    expect(typeof onRequestError).toBe("function");
  });

  it("onRequestError logs route errors best-effort without throwing", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("boom");

    expect(() =>
      onRequestError(
        boom,
        { path: "/api/v1/chat/completions", method: "POST" },
        { routeType: "route", routerKind: "App Router" },
      ),
    ).not.toThrow();

    expect(errSpy).toHaveBeenCalledOnce();
    const line = String(errSpy.mock.calls[0]?.[0]);
    expect(line).toContain("route");
    expect(line).toContain("POST");
    expect(line).toContain("/api/v1/chat/completions");
    expect(line).toContain("boom");
  });

  it("onRequestError tolerates missing request/context fields", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => onRequestError(new Error("x"), {} as never, {} as never)).not.toThrow();
    expect(errSpy).toHaveBeenCalledOnce();
  });

  it("register() skips console capture outside the nodejs runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    // Must not import consoleLogBuffer nor throw.
    await expect(register()).resolves.toBeUndefined();
  });
});

import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

const startupMocks = vi.hoisted(() => ({
  capture: vi.fn(),
  outboundProxy: vi.fn(async () => true),
  initializeApp: vi.fn(async () => undefined),
}));

vi.mock("@/lib/consoleLogBuffer", () => ({ initConsoleLogCapture: startupMocks.capture }));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: startupMocks.outboundProxy }));
vi.mock("@/shared/services/initializeApp", () => ({ initializeApp: startupMocks.initializeApp }));

import { register, onRequestError } from "@/instrumentation";

describe("instrumentation (FASE 5)", () => {
  beforeEach(() => {
    globalThis.__modelHubInstrumentationRegistered = false;
    vi.clearAllMocks();
  });

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
    expect(startupMocks.capture).not.toHaveBeenCalled();
  });

  it("register() skips all startup work during build and prerender", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");

    await register();

    expect(startupMocks.capture).not.toHaveBeenCalled();
    expect(startupMocks.outboundProxy).not.toHaveBeenCalled();
    expect(startupMocks.initializeApp).not.toHaveBeenCalled();
  });

  it("register() initializes Node services only once across repeated HMR calls", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "phase-development-server");

    await register();
    await register();

    expect(startupMocks.capture).toHaveBeenCalledOnce();
    expect(startupMocks.outboundProxy).toHaveBeenCalledOnce();
    expect(startupMocks.initializeApp).toHaveBeenCalledOnce();
  });
});

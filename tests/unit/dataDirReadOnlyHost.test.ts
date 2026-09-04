import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Booting on a host whose home directory cannot be created.
 *
 * This is the Vercel failure: `os.homedir()` reports something like
 * /home/sbx_user1051 which does not exist and cannot be created, so a write
 * under it fails with ENOENT and only the OS temp dir is writable.
 *
 * It was fatal rather than degraded because `dashboardSession` computed the JWT
 * secret at import time and is reachable from the Next middleware — the throw
 * landed during module evaluation, so every request 500'd before reaching any
 * route. The two properties asserted here are: DATA_DIR resolves to somewhere
 * writable, and importing the auth module does not throw.
 */
const UNCREATABLE = "/nonexistent-root-for-tests/home/sbx_user";

/**
 * Node's `path` binds to the host platform when it loads, so `path.join`
 * produces "\" separators on Windows no matter what `process.platform` says.
 * Every comparison here is separator-agnostic so the test asserts the fallback
 * logic rather than the runner's platform.
 */
function norm(value: string): string {
  return String(value).replaceAll("\\", "/");
}

let mkdirCalls: string[] = [];
/** When true, even the temp dir refuses writes — the true last-resort path. */
let tempAlsoUnwritable = false;

function mockFsWithUnwritableHome() {
  vi.doMock("node:fs", () => {
    const store = new Set<string>();
    const api = {
      mkdirSync: (dir: string) => {
        mkdirCalls.push(dir);
        // Anything under the fake home behaves like Vercel's read-only /home.
        if (norm(dir).startsWith(UNCREATABLE) || (tempAlsoUnwritable && norm(dir).startsWith("/tmp"))) {
          const error = new Error(`ENOENT: no such file or directory, mkdir '${dir}'`) as NodeJS.ErrnoException;
          error.code = "ENOENT";
          error.errno = -2;
          error.syscall = "mkdir";
          throw error;
        }
        store.add(String(dir));
        return undefined;
      },
      existsSync: (p: string) => store.has(String(p)),
      readFileSync: () => {
        const error = new Error("ENOENT") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      },
      writeFileSync: (p: string) => {
        if (norm(p).startsWith(UNCREATABLE) || (tempAlsoUnwritable && norm(p).startsWith("/tmp"))) {
          const error = new Error("EROFS: read-only file system") as NodeJS.ErrnoException;
          error.code = "EROFS";
          throw error;
        }
        return undefined;
      },
    };
    return { ...api, default: api };
  });
  vi.doMock("os", () => {
    const api = { homedir: () => UNCREATABLE, tmpdir: () => "/tmp" };
    return { ...api, default: api };
  });
  vi.doMock("node:os", () => {
    const api = { homedir: () => UNCREATABLE, tmpdir: () => "/tmp" };
    return { ...api, default: api };
  });
}

const realPlatform = process.platform;

function asLinux(): void {
  // homeDir() branches on process.platform, which the `os` mock cannot reach.
  Object.defineProperty(process, "platform", { value: "linux", configurable: true });
}

beforeEach(() => {
  mkdirCalls = [];
  tempAlsoUnwritable = false;
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("DATA_DIR", "");
  vi.stubEnv("JWT_SECRET", "");
  asLinux();
});

afterEach(() => {
  Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
  vi.doUnmock("node:fs");
  vi.doUnmock("os");
  vi.doUnmock("node:os");
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("data directory on a host with an uncreatable home", () => {
  it("falls back to the temp directory instead of throwing", async () => {
    mockFsWithUnwritableHome();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { DATA_DIR } = await import("@/lib/dataDir");

    expect(norm(DATA_DIR)).toBe("/tmp/modelhub");
    // The home directory was attempted first — the fallback is a fallback, not
    // a new default that would move data on a healthy machine.
    expect(norm(mkdirCalls[0] ?? "")).toContain(UNCREATABLE);
    // And the operator is told, because this location loses data on restart.
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/not durable/);
    warn.mockRestore();
  });

  it("prefers a writable DATA_DIR when one is configured", async () => {
    mockFsWithUnwritableHome();
    vi.stubEnv("DATA_DIR", "/var/data/modelhub");

    const { DATA_DIR } = await import("@/lib/dataDir");

    expect(norm(DATA_DIR)).toBe("/var/data/modelhub");
  });
});

describe("auth module on a host with an uncreatable home", () => {
  it("imports without throwing, so the middleware still loads", async () => {
    mockFsWithUnwritableHome();
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // The regression: this import used to throw during module evaluation and
    // take down every request in the app.
    await expect(import("@/lib/auth/dashboardSession")).resolves.toBeDefined();
  });

  it("still signs and verifies a token when the secret cannot be persisted", async () => {
    mockFsWithUnwritableHome();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // The dataDir fallback normally rescues this, so force the last-resort
    // case: nothing at all is writable, not even the temp dir.
    tempAlsoUnwritable = true;

    const mod = await import("@/lib/auth/dashboardSession");
    const cookies: Array<{ name: string; value: string }> = [];
    await mod.setDashboardAuthCookie(
      { set: (name: string, value: string) => cookies.push({ name, value }) } as never,
      { headers: { get: () => null } } as never,
    );

    const token = cookies.find((c) => c.name === "auth_token")?.value ?? "";
    expect(token).not.toBe("");
    expect(await mod.verifyDashboardAuthToken(token)).toBe(true);
    // Loud about it: an in-memory secret means sessions die on restart.
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mocks must be declared before importing the module under test.
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn() }));
vi.mock("@/lib/headroom/detect", () => ({
  DEFAULT_HEADROOM_URL: "http://localhost:8787",
  getHeadroomStatus: vi.fn(),
}));
vi.mock("@/lib/headroom/process", () => ({ getManagedPid: vi.fn() }));

import { GET, resetHeadroomStatusCache } from "@/server/application/use-cases/http/headroom/status/route";
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { getHeadroomStatus } from "@/lib/headroom/detect";
import { getManagedPid } from "@/lib/headroom/process";

const FAKE_STATUS = {
  installed: true,
  path: "/usr/local/bin/headroom",
  running: true,
  python: "/usr/bin/python3",
  localUrl: true,
  canStart: true,
  version: "1.2.3",
  extras: { code: true, ml: false },
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetHeadroomStatusCache();
  vi.mocked(getSettings).mockResolvedValue({ headroomUrl: "" } as never);
  vi.mocked(getHeadroomStatus).mockResolvedValue(FAKE_STATUS);
  vi.mocked(getManagedPid).mockReturnValue(12345);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GET /api/headroom/status — request coalescing", () => {
  it("calls getHeadroomStatus exactly once for concurrent GET requests", async () => {
    // Fire 3 requests simultaneously (same tick).
    const [res1, res2, res3] = await Promise.all([GET(), GET(), GET()]);

    expect(getHeadroomStatus).toHaveBeenCalledTimes(1);
    // All three should resolve to the same data.
    const json1 = await res1.json();
    const json2 = await res2.json();
    const json3 = await res3.json();
    expect(json1).toEqual(json2);
    expect(json2).toEqual(json3);
    expect(json1.url).toBe("http://localhost:8787");
    expect(json1.managedPid).toBe(12345);
  });

  it("serves cached result within TTL without re-calling getHeadroomStatus", async () => {
    // First call — populates cache.
    await GET();
    expect(getHeadroomStatus).toHaveBeenCalledTimes(1);

    // Advance less than the TTL (2s).
    vi.advanceTimersByTime(1500);

    // Second call — should hit cache.
    const res = await GET();
    expect(getHeadroomStatus).toHaveBeenCalledTimes(1);
    const json = await res.json();
    expect(json.running).toBe(true);
  });

  it("re-calls getHeadroomStatus after TTL expires", async () => {
    // First call.
    await GET();
    expect(getHeadroomStatus).toHaveBeenCalledTimes(1);

    // Advance past the TTL (2s + margin).
    vi.advanceTimersByTime(2500);

    // Second call — cache expired, should re-invoke.
    await GET();
    expect(getHeadroomStatus).toHaveBeenCalledTimes(2);
  });

  it("returns 500 on error and does not cache the failure", async () => {
    vi.mocked(getHeadroomStatus).mockRejectedValueOnce(new Error("boom"));

    const res = await GET();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("boom");

    // Next call should retry (error not cached).
    vi.mocked(getHeadroomStatus).mockResolvedValueOnce(FAKE_STATUS);
    const res2 = await GET();
    expect(res2.status).toBe(200);
    expect(getHeadroomStatus).toHaveBeenCalledTimes(2);
  });

  it("uses settings.headroomUrl when available", async () => {
    vi.mocked(getSettings).mockResolvedValue({ headroomUrl: "http://custom:9999" } as never);

    const res = await GET();
    const json = await res.json();
    expect(json.url).toBe("http://custom:9999");
    expect(getHeadroomStatus).toHaveBeenCalledWith("http://custom:9999");
  });

  it("falls back to DEFAULT_HEADROOM_URL when settings.headroomUrl is empty", async () => {
    vi.mocked(getSettings).mockResolvedValue({ headroomUrl: "" } as never);

    const res = await GET();
    const json = await res.json();
    expect(json.url).toBe("http://localhost:8787");
    expect(getHeadroomStatus).toHaveBeenCalledWith("http://localhost:8787");
  });
});

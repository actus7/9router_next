// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseLimit, useProfileSettings } from "@/app/(dashboard)/dashboard/profile/hooks/useProfileSettings";
import { useDatabaseBackup } from "@/app/(dashboard)/dashboard/profile/hooks/useDatabaseBackup";
import { useDecisionEngine } from "@/app/(dashboard)/dashboard/profile/hooks/useDecisionEngine";

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as unknown as Response;
}

/** Only `text()` and `name` are read by the code under test, so a plain object stands in for File. */
function fakeFile(name: string, content: string): File {
  return { name, text: async () => content } as unknown as File;
}

function changeEvent(file: File): React.ChangeEvent<HTMLInputElement> {
  return { target: { files: [file] } } as unknown as React.ChangeEvent<HTMLInputElement>;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseLimit", () => {
  it("accepts whole numbers inside the range", () => {
    expect(parseLimit("1", 10)).toBe(1);
    expect(parseLimit(" 10 ", 10)).toBe(10);
  });

  it("rejects empty, zero, out-of-range, fractional and non-numeric text", () => {
    expect(parseLimit("", 10)).toBeNull();
    expect(parseLimit("0", 10)).toBeNull();
    expect(parseLimit("11", 10)).toBeNull();
    expect(parseLimit("2.5", 10)).toBeNull();
    expect(parseLimit("abc", 10)).toBeNull();
  });
});

describe("useProfileSettings: saving a routing setting", () => {
  it("keeps the previous value and reports an error when the server refuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, false)));
    const { result } = renderHook(() => useProfileSettings({ fallbackStrategy: "fill-first" }));

    await act(async () => {
      await result.current.updateFallbackStrategy("round-robin");
    });

    expect(result.current.settings.fallbackStrategy).toBe("fill-first");
    expect(result.current.saveError).toMatch(/could not be saved/i);
    expect(result.current.loading).toBe(false);
  });

  it("applies the value and clears a previous error once the server keeps it", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, false))
      .mockResolvedValueOnce(jsonResponse({}, true)));
    const { result } = renderHook(() => useProfileSettings({ fallbackStrategy: "fill-first" }));

    await act(async () => { await result.current.updateFallbackStrategy("round-robin"); });
    await act(async () => { await result.current.updateFallbackStrategy("round-robin"); });

    expect(result.current.settings.fallbackStrategy).toBe("round-robin");
    expect(result.current.saveError).toBeNull();
  });

  it("never sends an empty or out-of-range sticky limit", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, true));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useProfileSettings({ stickyRoundRobinLimit: 3 }));

    await act(async () => {
      await result.current.updateStickyLimit("");
      await result.current.updateStickyLimit("11");
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.settings.stickyRoundRobinLimit).toBe(3);
  });
});

describe("useDatabaseBackup: import validation", () => {
  it("does not open the destructive confirmation for a file that is not JSON", async () => {
    const { result } = renderHook(() => useDatabaseBackup(async () => {}));

    await act(async () => {
      await result.current.handleImportDatabase(changeEvent(fakeFile("backup.json", "not json")));
    });

    expect(result.current.pendingImport).toBeNull();
    expect(result.current.dbStatus.type).toBe("error");
  });

  it("opens the confirmation with the file when the JSON parses", async () => {
    const { result } = renderHook(() => useDatabaseBackup(async () => {}));

    await act(async () => {
      await result.current.handleImportDatabase(changeEvent(fakeFile("backup.json", "{\"providers\":[]}")));
    });

    expect(result.current.pendingImport?.name).toBe("backup.json");
    expect(result.current.dbStatus.type).toBe("");
  });
});

describe("useDecisionEngine: key status and removal", () => {
  it("flags the key status as unknown when both lookups fail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const { result } = renderHook(() => useDecisionEngine(() => {}));

    await waitFor(() => expect(result.current.keyStatusFailed).toBe(true));
    expect(result.current.hasTypesafeKey).toBeNull();
    expect(result.current.hasGatewayKey).toBeNull();
  });

  it("does not flag a failure when one lookup answers", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (
      url.includes("/api/decisions/jev/key")
        ? jsonResponse({ typesafe: false }, true)
        : jsonResponse({}, false)
    )));
    const { result } = renderHook(() => useDecisionEngine(() => {}));

    await waitFor(() => expect(result.current.hasTypesafeKey).toBe(false));
    expect(result.current.keyStatusFailed).toBe(false);
  });

  it("reports a failed removal and keeps the key marked as present", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => (
      init?.method === "DELETE" ? jsonResponse({}, false) : jsonResponse({ typesafe: true }, true)
    )));
    const { result } = renderHook(() => useDecisionEngine(() => {}));
    await waitFor(() => expect(result.current.hasTypesafeKey).toBe(true));

    await act(async () => { await result.current.removeTypesafeKey(); });

    expect(result.current.hasTypesafeKey).toBe(true);
    expect(result.current.error).toBe("Could not remove the key");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

// `bootstrap()` reads the stored patch layer, which reaches getAdapter() and so
// ran the real migration chain against the operator's own database in
// %APPDATA%/modelhub (or ~/.modelhub) on every run of the suite. The empty
// patch layer mocked here is the same thing `readPatchLayer` falls back to when
// the database is unreachable, so the composition under test is unchanged —
// bundle defaults with no patch — while the test stops writing to live data.
vi.mock("@/lib/db/repos/pluginRowsRepo", () => ({
  listPluginRows: vi.fn(async () => []),
  getPluginTreeRevision: vi.fn(async () => 0),
  upsertPluginRow: vi.fn(async () => {}),
  deletePluginRow: vi.fn(async () => {}),
}));

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

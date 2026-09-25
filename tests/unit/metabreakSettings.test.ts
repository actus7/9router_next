import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("@/lib/db/driver", () => ({ getAdapter: async () => ({
  get: async () => ({ data: JSON.stringify(store.data) }),
  run: async (_sql: string, values: unknown[]) => { store.data = JSON.parse(values[1] as string); },
  transaction: async (fn: () => Promise<void>) => fn(),
}) }));

import { exportSettings, getSettings, invalidateSettingsCache, updateSettings } from "@/lib/db/repos/settingsRepo";

describe("MetaBreak settings compatibility", () => {
  beforeEach(() => { store.data = {}; invalidateSettingsCache(); });
  it("defaults to disabled", async () => {
    expect((await getSettings()).metaBreakEnabled).toBe(false);
  });
  it("reads the old toggle and omits the retired prompt from reads and exports", async () => {
    store.data = { jailbreakEnabled: true, jailbreakPrompt: "obsolete", metaBreakPrompt: "override" };
    expect((await getSettings()).metaBreakEnabled).toBe(true);
    expect(await exportSettings()).toEqual({ metaBreakEnabled: true });
  });
  it("keeps explicit false over legacy true and removes old keys on write", async () => {
    store.data = { jailbreakEnabled: true, jailbreakPrompt: "obsolete", rtkEnabled: true };
    const result = await updateSettings({ metaBreakEnabled: false });
    expect(result.metaBreakEnabled).toBe(false);
    expect(store.data).toEqual({ metaBreakEnabled: false, rtkEnabled: true });
    expect((await getSettings()).metaBreakEnabled).toBe(false);
  });
  it("accepts legacy toggles without accepting custom prompt overrides", async () => {
    store.data = { metaBreakEnabled: false, rtkEnabled: false };
    await updateSettings({ jailbreakEnabled: true, jailbreakPrompt: "override", metaBreakPrompt: "override" });
    expect(store.data).toEqual({ metaBreakEnabled: true, rtkEnabled: false });
  });
});

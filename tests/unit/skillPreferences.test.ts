import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readSkillPreferences,
  resolveSkillSessionEnabled,
  writeSkillPreference,
} from "@/shared/harness/skillPreferences";

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    },
  });
});

describe("skillPreferences", () => {
  it("persists enabled state for reuse in later chats", () => {
    writeSkillPreference("brainstorming", true);
    expect(readSkillPreferences()).toEqual({ brainstorming: true });

    writeSkillPreference("brainstorming", false);
    expect(readSkillPreferences()).toEqual({ brainstorming: false });
  });

  it("returns a stable snapshot reference until the stored value changes", () => {
    const first = readSkillPreferences();
    expect(readSkillPreferences()).toBe(first);

    writeSkillPreference("brainstorming", true);
    const afterWrite = readSkillPreferences();
    expect(afterWrite).not.toBe(first);
    expect(readSkillPreferences()).toBe(afterWrite);

    storage.set("harness.skillPreferences", JSON.stringify({ brainstorming: false }));
    expect(readSkillPreferences()).not.toBe(afterWrite);
    expect(readSkillPreferences()).toEqual({ brainstorming: false });
  });

  it("prefers harness preferences over per-session overrides", () => {
    const enabled = resolveSkillSessionEnabled(
      { id: "demo", enabled: false },
      { demo: true },
      { demo: false },
    );
    expect(enabled).toBe(true);
  });
});

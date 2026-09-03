// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

import { useSkillPreferences } from "@/app/(dashboard)/dashboard/basic-chat/hooks/useSkillPreferences";

const STORAGE_KEY = "harness.skillPreferences";

describe("useSkillPreferences – snapshot stability", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  // A getSnapshot that parses JSON on every call returns a new object per render,
  // which React reads as an endless stream of store updates ("Maximum update
  // depth exceeded"). Re-rendering must not change the snapshot identity.
  it("keeps the same preferences object across re-renders", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ brainstorming: true }));
    const { result, rerender } = renderHook(() => useSkillPreferences());

    const first = result.current.preferences;
    rerender();
    rerender();

    expect(result.current.preferences).toBe(first);
    expect(result.current.preferences).toEqual({ brainstorming: true });
  });

  it("publishes a new snapshot once a preference is written", () => {
    const { result } = renderHook(() => useSkillPreferences());
    const before = result.current.preferences;

    act(() => {
      result.current.setSkillEnabled("brainstorming", true);
    });

    expect(result.current.preferences).not.toBe(before);
    expect(result.current.preferences).toEqual({ brainstorming: true });
    expect(result.current.setSkillEnabled).toBeTypeOf("function");
  });
});

import { describe, expect, it } from "vitest";
import { computeProviderEntries } from "@/app/(dashboard)/dashboard/providers/hooks/computeProviderEntries";

// The Providers page lists every kind; the "Chat" chip narrows it back to LLMs
// in every group (decision of 2026-10-31, when the Mídia menu was folded in).
describe("computeProviderEntries", () => {
  it("lists only llm providers in every group when the Chat chip is selected", () => {
    const groups = computeProviderEntries("", [], ["llm"]);
    const ids = Object.values(groups).flat().map(([id]) => id);

    expect(ids).not.toContain("anysearch");
    expect(ids).not.toContain("context7");
    expect(ids).not.toContain("suno");
    expect(ids).not.toContain("udio");
    expect(ids).toContain("opencode");
    expect(ids).toContain("antigravity");
  });
});

import { describe, expect, it } from "vitest";
import { computeProviderEntries } from "@/app/(dashboard)/dashboard/providers/hooks/computeProviderEntries";

// Search and music services live under Mídia (/dashboard/media-providers/*);
// the Providers page is for LLMs only, in every group.
describe("computeProviderEntries", () => {
  it("lists only llm providers in every group", () => {
    const groups = computeProviderEntries("", []);
    const ids = Object.values(groups).flat().map(([id]) => id);

    expect(ids).not.toContain("anysearch");
    expect(ids).not.toContain("context7");
    expect(ids).not.toContain("suno");
    expect(ids).not.toContain("udio");
    expect(ids).toContain("opencode");
    expect(ids).toContain("antigravity");
  });
});

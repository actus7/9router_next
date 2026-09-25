import { describe, expect, it } from "vitest";
import {
  buildSkillInstallUrlCandidates,
  parseOwnerRepo,
  skillFolderNameCandidates,
} from "@/server/harness/skills/resolveSkillInstallUrl";
import {
  FEATURED_LIBRARY_SKILLS,
  formatInstallCount,
  getSkillLibrary,
  SKILL_LIBRARIES,
} from "@/shared/harness/skillLibraries";

describe("skillLibraries", () => {
  it("includes recommended curated libraries", () => {
    expect(getSkillLibrary("anthropics")?.source).toBe("anthropics/skills");
    expect(getSkillLibrary("superpowers")?.source).toBe("obra/superpowers");
    expect(getSkillLibrary("vercel")?.owner).toBe("vercel-labs");
    expect(getSkillLibrary("mattpocock")?.source).toBe("mattpocock/skills");
    expect(getSkillLibrary("awesome-copilot")?.source).toBe("github/awesome-copilot");
    expect(getSkillLibrary("remotion")?.source).toBe("remotion-dev/skills");
    expect(getSkillLibrary("cloudflare")?.source).toBe("cloudflare/skills");
    expect(getSkillLibrary("firecrawl")?.source).toBe("firecrawl/cli");
  });

  it("has no duplicate library or featured skill ids", () => {
    const libraryIds = SKILL_LIBRARIES.map((library) => library.id);
    expect(new Set(libraryIds).size).toBe(libraryIds.length);
    const featuredIds = FEATURED_LIBRARY_SKILLS.map((skill) => skill.id);
    expect(new Set(featuredIds).size).toBe(featuredIds.length);
    for (const skill of FEATURED_LIBRARY_SKILLS) {
      expect(getSkillLibrary(skill.libraryId ?? "")?.source ?? skill.source).toBe(skill.source);
    }
  });

  it("formats install counts for display", () => {
    expect(formatInstallCount(349_037)).toBe("349k");
    expect(formatInstallCount(1_200_000)).toBe("1.2M");
    expect(formatInstallCount(42)).toBe("42");
  });

  it("ships featured skills for empty search", () => {
    expect(FEATURED_LIBRARY_SKILLS.length).toBeGreaterThan(4);
    expect(
      FEATURED_LIBRARY_SKILLS.some((skill) => skill.source === "obra/superpowers"),
    ).toBe(true);
  });
});

describe("resolveSkillInstallUrl", () => {
  it("builds raw GitHub candidates for common repos", () => {
    const urls = buildSkillInstallUrlCandidates("obra/superpowers", "brainstorming");
    expect(urls[0]).toBe(
      "https://raw.githubusercontent.com/obra/superpowers/main/skills/brainstorming/SKILL.md",
    );
    expect(urls.some((url) => url.includes("/master/"))).toBe(true);
  });

  it("maps vercel skills.sh slugs to on-disk folder names", () => {
    expect(skillFolderNameCandidates("vercel-react-best-practices")).toEqual([
      "vercel-react-best-practices",
      "react-best-practices",
    ]);
    const urls = buildSkillInstallUrlCandidates(
      "vercel-labs/agent-skills",
      "vercel-react-best-practices",
    );
    expect(urls).toContain(
      "https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/react-best-practices/SKILL.md",
    );
  });

  it("parses owner/repo from source", () => {
    expect(parseOwnerRepo("anthropics/skills")).toEqual({
      owner: "anthropics",
      repo: "skills",
    });
    expect(parseOwnerRepo("invalid")).toBeNull();
  });
});

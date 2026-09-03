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
} from "@/shared/harness/skillLibraries";

describe("skillLibraries", () => {
  it("includes recommended curated libraries", () => {
    expect(getSkillLibrary("anthropics")?.source).toBe("anthropics/skills");
    expect(getSkillLibrary("superpowers")?.source).toBe("obra/superpowers");
    expect(getSkillLibrary("vercel")?.owner).toBe("vercel-labs");
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

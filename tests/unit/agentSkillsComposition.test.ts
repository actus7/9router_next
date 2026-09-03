import { describe, expect, it } from "vitest";
import {
  BUNDLE_SKILLS,
} from "@/shared/harness/bundleSkills";
import {
  buildSkillsPromptBlock,
  composeSkills,
  resolveSessionSkillsFrom,
} from "@/shared/harness/agentSkills";

describe("composeSkills", () => {
  it("reproduces bundle when patch is empty", () => {
    const { skills, diagnostics } = composeSkills(BUNDLE_SKILLS, []);
    expect(diagnostics).toHaveLength(0);
    expect(skills.map((s) => s.id)).toContain("skill-creator");
    expect(skills.find((s) => s.id === "skill-creator")?.bundled).toBe(true);
  });

  it("applies enabled override on bundled skill", () => {
    const { skills } = composeSkills(BUNDLE_SKILLS, [
      {
        id: "skill-creator",
        name: "skill-creator",
        description: "ignored",
        body: "ignored",
        enabled: false,
        source: "override",
      },
    ]);
    expect(skills.find((s) => s.id === "skill-creator")?.enabled).toBe(false);
    expect(skills.find((s) => s.id === "skill-creator")?.origin).toBe(
      "override",
    );
  });

  it("inserts user skill from patch", () => {
    const { skills } = composeSkills(BUNDLE_SKILLS, [
      {
        id: "custom-skill",
        name: "custom-skill",
        description: "Custom",
        body: "Do custom things.",
        enabled: true,
        source: "user",
      },
    ]);
    expect(skills.find((s) => s.id === "custom-skill")?.origin).toBe("user");
  });
});

describe("resolveSessionSkillsFrom", () => {
  const catalog = {
    skills: [
      {
        id: "a",
        name: "a",
        description: "A",
        body: "body",
        enabled: true,
        origin: "bundle" as const,
        bundled: true,
      },
      {
        id: "b",
        name: "b",
        description: "B",
        body: "body",
        enabled: false,
        origin: "user" as const,
      },
    ],
  };

  it("excludes globally disabled skills", () => {
    expect(resolveSessionSkillsFrom(catalog, {}).map((s) => s.id)).toEqual([
      "a",
    ]);
  });

  it("honours session override to enable", () => {
    expect(
      resolveSessionSkillsFrom(catalog, { b: true }).map((s) => s.id),
    ).toEqual(["a", "b"]);
  });

  it("honours session override to disable", () => {
    expect(
      resolveSessionSkillsFrom(catalog, { a: false }).map((s) => s.id),
    ).toEqual([]);
  });

  it("honours persisted harness preferences across sessions", () => {
    expect(
      resolveSessionSkillsFrom(catalog, {}, { b: true }).map((s) => s.id),
    ).toEqual(["a", "b"]);
    expect(
      resolveSessionSkillsFrom(catalog, { b: false }, { b: true }).map((s) => s.id),
    ).toEqual(["a", "b"]);
  });
});

describe("buildSkillsPromptBlock", () => {
  it("returns empty string for no skills", () => {
    expect(buildSkillsPromptBlock([])).toBe("");
  });

  it("lists skill ids and descriptions", () => {
    const block = buildSkillsPromptBlock([
      {
        id: "demo",
        name: "demo",
        description: "Demo skill",
        body: "x",
        enabled: true,
        origin: "user",
      },
    ]);
    expect(block).toContain("demo: Demo skill");
    expect(block).toContain("load_skill");
  });
});

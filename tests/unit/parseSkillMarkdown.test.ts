import { describe, expect, it } from "vitest";
import {
  parseSkillMarkdown,
  serializeSkillMarkdown,
  validateSkillFields,
} from "@/server/harness/skills/parseSkillMarkdown";

describe("parseSkillMarkdown", () => {
  it("parses valid frontmatter and body", () => {
    const raw = `---
name: my-skill
description: Does something useful
---

# Title

Body text.
`;
    expect(parseSkillMarkdown(raw)).toEqual({
      name: "my-skill",
      description: "Does something useful",
      body: "# Title\n\nBody text.",
    });
  });

  it("rejects missing frontmatter", () => {
    expect(() => parseSkillMarkdown("# no frontmatter")).toThrow(/frontmatter/i);
  });

  it("rejects missing name", () => {
    expect(() =>
      parseSkillMarkdown("---\ndescription: x\n---\n\nbody"),
    ).toThrow(/name/i);
  });

  it("serializes round-trip shape", () => {
    const skill = {
      name: "demo",
      description: "Demo skill",
      body: "Steps here.",
    };
    const serialized = serializeSkillMarkdown(skill);
    expect(parseSkillMarkdown(serialized).name).toBe("demo");
  });
});

describe("validateSkillFields", () => {
  it("rejects invalid slug", () => {
    const errors = validateSkillFields({
      id: "Bad_Slug",
      description: "ok",
      body: "body",
    });
    expect(errors.some((e) => e.field === "id")).toBe(true);
  });

  it("rejects oversized body", () => {
    const errors = validateSkillFields({
      id: "ok-skill",
      description: "ok",
      body: "x".repeat(64 * 1024 + 1),
    });
    expect(errors.some((e) => e.field === "body")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { isValidSkillFilePath } from "@/lib/db/repos/agentSkillFilesRepo";

describe("agentSkillFiles", () => {
  it("accepts safe relative paths", () => {
    expect(isValidSkillFilePath("references/guide.md")).toBe(true);
  });

  it("rejects path traversal", () => {
    expect(isValidSkillFilePath("../secret.txt")).toBe(false);
  });
});

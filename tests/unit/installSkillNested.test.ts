import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/repos/agentSkillsRepo", () => ({
  upsertAgentSkillRow: vi.fn(async () => undefined),
}));
vi.mock("@/server/harness/skills/context", () => ({
  invalidateSkillTreeCache: vi.fn(async () => undefined),
}));
vi.mock("@/server/security/safeFetch", () => ({
  safePublicFetch: vi.fn(),
}));

import { safePublicFetch } from "@/server/security/safeFetch";
import { installSkillFromLibrary } from "@/server/harness/skills/installSkillFromLibrary";

const SKILL_MD = "---\nname: grill-me\ndescription: Interview the user relentlessly.\n---\n\nAsk one question at a time.\n";
const NESTED_RAW =
  "https://raw.githubusercontent.com/mattpocock/skills/main/skills/productivity/grill-me/SKILL.md";

beforeEach(() => vi.clearAllMocks());

describe("installSkillFromLibrary", () => {
  it("finds a SKILL.md nested under a category folder (mattpocock/skills layout)", async () => {
    vi.mocked(safePublicFetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/git/trees/main")) {
        return Response.json({
          truncated: false,
          tree: [
            { path: "skills/engineering/tdd/SKILL.md", type: "blob" },
            { path: "skills/productivity/grill-me/SKILL.md", type: "blob" },
          ],
        });
      }
      if (url === NESTED_RAW) return new Response(SKILL_MD);
      return new Response("not found", { status: 404 });
    });

    const outcome = await installSkillFromLibrary({
      source: "mattpocock/skills",
      skillId: "grill-me",
    });

    expect(outcome).toEqual({ ok: true, skillId: "grill-me", url: NESTED_RAW });
  });
});

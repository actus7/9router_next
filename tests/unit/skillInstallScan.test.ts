import { beforeEach, describe, expect, it, vi } from "vitest";

// Security scan on skill installs: a SKILL.md becomes standing instructions
// for every agent turn it applies to, so a confident High verdict blocks the
// install outright. Null or a weak verdict installs as before (fail-open).

const upsertAgentSkillRow = vi.hoisted(() => vi.fn(async () => undefined));
const invalidateSkillTreeCache = vi.hoisted(() => vi.fn(async () => undefined));
const safePublicFetch = vi.hoisted(() => vi.fn());
const decideWithJev = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/repos/agentSkillsRepo", () => ({ upsertAgentSkillRow }));
vi.mock("@/server/harness/skills/context", () => ({ invalidateSkillTreeCache }));
vi.mock("@/server/security/safeFetch", () => ({ safePublicFetch }));
vi.mock("@/server/decisions/jev", () => ({ decideWithJev }));

import { installSkillFromLibrary } from "@/server/harness/skills/installSkillFromLibrary";

const SKILL_MD = "---\nname: grill-me\ndescription: Interview the user relentlessly.\n---\n\nAsk one question at a time.\n";

function jevMalicious(score: number, confidence: number) {
  return {
    answers: { malicious: { type: "score", score, confidence, probabilities: {} } },
    source: "jev",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  decideWithJev.mockResolvedValue(null);
  safePublicFetch.mockResolvedValue(new Response(SKILL_MD));
});

describe("installSkillFromLibrary security scan", () => {
  it("blocks a skill Jev confidently calls dangerous", async () => {
    decideWithJev.mockResolvedValue(jevMalicious(3.0, 0.9));

    const outcome = await installSkillFromLibrary({ source: "some/repo", skillId: "grill-me" });

    expect(outcome).toEqual({ ok: false, error: "Skill blocked by security scan" });
    expect(upsertAgentSkillRow).not.toHaveBeenCalled();
    expect(decideWithJev.mock.calls[0]?.[0]).toBe("skillScan");
    expect(decideWithJev.mock.calls[0]?.[3]).toEqual({ timeoutMs: 5_000 });
  });

  it("installs a skill Jev scores low", async () => {
    decideWithJev.mockResolvedValue(jevMalicious(2.0, 0.9));

    const outcome = await installSkillFromLibrary({ source: "some/repo", skillId: "grill-me" });

    expect(outcome).toMatchObject({ ok: true, skillId: "grill-me" });
    expect(upsertAgentSkillRow).toHaveBeenCalledOnce();
  });

  it("installs when Jev does not answer", async () => {
    decideWithJev.mockResolvedValue(null);

    const outcome = await installSkillFromLibrary({ source: "some/repo", skillId: "grill-me" });

    expect(outcome).toMatchObject({ ok: true, skillId: "grill-me" });
  });

  it("installs a high score Jev is not confident about", async () => {
    decideWithJev.mockResolvedValue(jevMalicious(2.8, 0.7));

    const outcome = await installSkillFromLibrary({ source: "some/repo", skillId: "grill-me" });

    expect(outcome).toMatchObject({ ok: true, skillId: "grill-me" });
    expect(upsertAgentSkillRow).toHaveBeenCalledOnce();
  });
});

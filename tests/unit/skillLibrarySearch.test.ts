import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { searchSkillLibrary } from "@/server/harness/skills/skillLibrarySearch";

const skill = (source: string, skillId: string) => ({
  id: `${source}/${skillId}`,
  source,
  skillId,
  name: skillId,
  installs: 1,
});

afterEach(() => vi.unstubAllGlobals());

describe("searchSkillLibrary sem busca", () => {
  it("lista o catálogo inteiro da biblioteca, destaques primeiro e sem duplicar", async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      Response.json({
        skills: [
          skill("humanlayer/skills", "show-me"),
          skill("humanlayer/skills", "visual-pr"),
          skill("humanlayer/riptide-rpi", "rpi-setup-humanlayer"),
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { skills } = await searchSkillLibrary({ libraryId: "humanlayer" });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("owner=humanlayer");
    expect(skills.map((s) => s.skillId)).toEqual([
      "show-me",
      "build-iterated-agentic-loop",
      "visual-pr",
    ]);
  });

  it("cai nos destaques quando o skills.sh falha", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    const { skills } = await searchSkillLibrary({ libraryId: "humanlayer" });
    expect(skills.map((s) => s.skillId)).toEqual(["show-me", "build-iterated-agentic-loop"]);
  });

  it("'Todas' continua mostrando só os destaques, sem ir à rede", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await searchSkillLibrary({ libraryId: "all" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

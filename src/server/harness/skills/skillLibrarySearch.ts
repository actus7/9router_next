import "server-only";

import {
  FEATURED_LIBRARY_SKILLS,
  getSkillLibrary,
  type SkillLibraryEntry,
} from "@/shared/harness/skillLibraries";

const SKILLS_SH_SEARCH = "https://skills.sh/api/search";

interface SkillsShResult {
  id: string;
  skillId: string;
  name: string;
  installs: number;
  source: string;
}

interface SkillsShResponse {
  skills?: SkillsShResult[];
  count?: number;
}

function mapResult(skill: SkillsShResult, libraryId?: string): SkillLibraryEntry {
  return {
    id: skill.id,
    skillId: skill.skillId,
    name: skill.name,
    source: skill.source,
    installs: skill.installs ?? 0,
    libraryId,
  };
}

function featuredForLibrary(libraryId: string): SkillLibraryEntry[] {
  if (libraryId === "all") return [...FEATURED_LIBRARY_SKILLS];
  return FEATURED_LIBRARY_SKILLS.filter(
    (skill) => skill.libraryId === libraryId,
  );
}

export async function searchSkillLibrary(options: {
  query?: string;
  libraryId?: string;
  limit?: number;
}): Promise<{ skills: SkillLibraryEntry[]; query: string; libraryId: string }> {
  const libraryId = options.libraryId ?? "all";
  const query = options.query?.trim() ?? "";
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const library = getSkillLibrary(libraryId);

  if (!query) {
    return {
      query,
      libraryId,
      skills: featuredForLibrary(libraryId).slice(0, limit),
    };
  }

  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (library?.owner) params.set("owner", library.owner);
  else if (library?.source) params.set("owner", library.source.split("/")[0]!);

  try {
    const response = await fetch(`${SKILLS_SH_SEARCH}?${params.toString()}`, {
      headers: { accept: "application/json" },
      next: { revalidate: 300 },
    });
    if (!response.ok) {
      return { query, libraryId, skills: featuredForLibrary(libraryId).slice(0, limit) };
    }
    const data = (await response.json()) as SkillsShResponse;
    const skills = (data.skills ?? []).map((skill) => mapResult(skill, libraryId));
    if (library?.source) {
      return {
        query,
        libraryId,
        skills: skills.filter((skill) => skill.source === library.source).slice(0, limit),
      };
    }
    return { query, libraryId, skills: skills.slice(0, limit) };
  } catch {
    return { query, libraryId, skills: featuredForLibrary(libraryId).slice(0, limit) };
  }
}

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
  const owner = library?.owner ?? library?.source?.split("/")[0];

  // Sem busca: "Todas" mostra os destaques; uma biblioteca lista o próprio
  // catálogo (buscar pelo owner devolve o repo inteiro), destaques primeiro.
  if (!query) {
    const featured = featuredForLibrary(libraryId);
    if (!owner) return { query, libraryId, skills: featured.slice(0, limit) };
    const listed = await fetchLibrary(owner, owner, 50, library?.source, libraryId);
    const seen = new Set(featured.map((skill) => skill.id));
    const skills = [...featured, ...(listed ?? []).filter((skill) => !seen.has(skill.id))];
    return { query, libraryId, skills: skills.slice(0, 50) };
  }

  const skills = await fetchLibrary(query, owner, limit, library?.source, libraryId);
  return { query, libraryId, skills: (skills ?? featuredForLibrary(libraryId)).slice(0, limit) };
}

/** null quando o skills.sh falha — o chamador cai nos destaques. */
async function fetchLibrary(
  query: string,
  owner: string | undefined,
  limit: number,
  source: string | undefined,
  libraryId: string,
): Promise<SkillLibraryEntry[] | null> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (owner) params.set("owner", owner);

  try {
    const response = await fetch(`${SKILLS_SH_SEARCH}?${params.toString()}`, {
      headers: { accept: "application/json" },
      next: { revalidate: 300 },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as SkillsShResponse;
    const skills = (data.skills ?? []).map((skill) => mapResult(skill, libraryId));
    return source ? skills.filter((skill) => skill.source === source) : skills;
  } catch {
    return null;
  }
}

export interface SkillLibrary {
  id: string;
  title: string;
  description: string;
  /** owner/repo filter for skills.sh search */
  source?: string;
  /** GitHub owner filter for skills.sh */
  owner?: string;
  badge?: string;
  recommended: boolean;
}

export interface SkillLibraryEntry {
  id: string;
  skillId: string;
  name: string;
  source: string;
  installs: number;
  libraryId?: string;
}

export const SKILL_LIBRARIES: readonly SkillLibrary[] = [
  {
    id: "all",
    title: "Todas",
    description: "Busca global no registro skills.sh — 600k+ skills open source",
    recommended: true,
  },
  {
    id: "anthropics",
    title: "Anthropic Oficial",
    description: "Padrão SKILL.md canônico — documentos, arte, dados, MCP",
    owner: "anthropics",
    source: "anthropics/skills",
    badge: "Canônico",
    recommended: true,
  },
  {
    id: "superpowers",
    title: "Superpowers",
    description: "Metodologia de engenharia: TDD, debugging, planejamento",
    owner: "obra",
    source: "obra/superpowers",
    badge: "Processo",
    recommended: true,
  },
  {
    id: "vercel",
    title: "Vercel Labs",
    description: "React, Next.js e boas práticas de frontend",
    owner: "vercel-labs",
    badge: "Frontend",
    recommended: true,
  },
] as const;

/** Curated picks shown before the user types a query. */
export const FEATURED_LIBRARY_SKILLS: readonly SkillLibraryEntry[] = [
  {
    id: "obra/superpowers/brainstorming",
    skillId: "brainstorming",
    name: "brainstorming",
    source: "obra/superpowers",
    installs: 349_037,
    libraryId: "superpowers",
  },
  {
    id: "obra/superpowers/test-driven-development",
    skillId: "test-driven-development",
    name: "test-driven-development",
    source: "obra/superpowers",
    installs: 215_286,
    libraryId: "superpowers",
  },
  {
    id: "obra/superpowers/systematic-debugging",
    skillId: "systematic-debugging",
    name: "systematic-debugging",
    source: "obra/superpowers",
    installs: 180_000,
    libraryId: "superpowers",
  },
  {
    id: "anthropics/skills/pdf",
    skillId: "pdf",
    name: "pdf",
    source: "anthropics/skills",
    installs: 189_450,
    libraryId: "anthropics",
  },
  {
    id: "anthropics/skills/mcp-builder",
    skillId: "mcp-builder",
    name: "mcp-builder",
    source: "anthropics/skills",
    installs: 95_000,
    libraryId: "anthropics",
  },
  {
    id: "anthropics/skills/frontend-design",
    skillId: "frontend-design",
    name: "frontend-design",
    source: "anthropics/skills",
    installs: 104_177,
    libraryId: "anthropics",
  },
  {
    id: "vercel-labs/agent-skills/vercel-react-best-practices",
    skillId: "vercel-react-best-practices",
    name: "vercel-react-best-practices",
    source: "vercel-labs/agent-skills",
    installs: 120_000,
    libraryId: "vercel",
  },
  {
    id: "vercel-labs/agent-skills/web-design-guidelines",
    skillId: "web-design-guidelines",
    name: "web-design-guidelines",
    source: "vercel-labs/agent-skills",
    installs: 85_000,
    libraryId: "vercel",
  },
] as const;

export function getSkillLibrary(id: string): SkillLibrary | undefined {
  return SKILL_LIBRARIES.find((library) => library.id === id);
}

export function formatInstallCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1)}k`;
  return String(count);
}

export function skillLibraryPageUrl(entry: SkillLibraryEntry): string {
  return `https://skills.sh/${entry.id}`;
}

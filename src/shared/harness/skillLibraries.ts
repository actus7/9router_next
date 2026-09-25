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
  {
    id: "mattpocock",
    title: "Matt Pocock",
    description: "Engenharia no dia a dia: TDD, arquitetura, triagem, handoff",
    owner: "mattpocock",
    source: "mattpocock/skills",
    badge: "Engenharia",
    recommended: true,
  },
  {
    id: "awesome-copilot",
    title: "GitHub Awesome Copilot",
    description: "Coleção da comunidade GitHub — 400+ skills de todo tipo",
    owner: "github",
    source: "github/awesome-copilot",
    badge: "Comunidade",
    recommended: false,
  },
  {
    id: "remotion",
    title: "Remotion",
    description: "Vídeo programático em React: criação, legendas, render",
    owner: "remotion-dev",
    source: "remotion-dev/skills",
    badge: "Vídeo",
    recommended: false,
  },
  {
    id: "cloudflare",
    title: "Cloudflare",
    description: "Workers, Durable Objects, Agents SDK, Wrangler",
    owner: "cloudflare",
    source: "cloudflare/skills",
    badge: "Edge",
    recommended: false,
  },
  {
    id: "firecrawl",
    title: "Firecrawl",
    description: "Scrape, crawl e busca na web pela CLI do Firecrawl",
    owner: "firecrawl",
    source: "firecrawl/cli",
    badge: "Web",
    recommended: false,
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
  {
    id: "mattpocock/skills/grill-me",
    skillId: "grill-me",
    name: "grill-me",
    source: "mattpocock/skills",
    installs: 1_221_026,
    libraryId: "mattpocock",
  },
  {
    id: "mattpocock/skills/tdd",
    skillId: "tdd",
    name: "tdd",
    source: "mattpocock/skills",
    installs: 964_882,
    libraryId: "mattpocock",
  },
  {
    id: "github/awesome-copilot/github-issues",
    skillId: "github-issues",
    name: "github-issues",
    source: "github/awesome-copilot",
    installs: 15_906,
    libraryId: "awesome-copilot",
  },
  {
    id: "github/awesome-copilot/web-design-reviewer",
    skillId: "web-design-reviewer",
    name: "web-design-reviewer",
    source: "github/awesome-copilot",
    installs: 13_730,
    libraryId: "awesome-copilot",
  },
  {
    id: "remotion-dev/skills/remotion-best-practices",
    skillId: "remotion-best-practices",
    name: "remotion-best-practices",
    source: "remotion-dev/skills",
    installs: 541_654,
    libraryId: "remotion",
  },
  {
    id: "cloudflare/skills/cloudflare",
    skillId: "cloudflare",
    name: "cloudflare",
    source: "cloudflare/skills",
    installs: 99_602,
    libraryId: "cloudflare",
  },
  {
    id: "cloudflare/skills/wrangler",
    skillId: "wrangler",
    name: "wrangler",
    source: "cloudflare/skills",
    installs: 96_972,
    libraryId: "cloudflare",
  },
  {
    id: "firecrawl/cli/firecrawl",
    skillId: "firecrawl",
    name: "firecrawl",
    source: "firecrawl/cli",
    installs: 101_830,
    libraryId: "firecrawl",
  },
  {
    id: "firecrawl/cli/firecrawl-scrape",
    skillId: "firecrawl-scrape",
    name: "firecrawl-scrape",
    source: "firecrawl/cli",
    installs: 82_358,
    libraryId: "firecrawl",
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

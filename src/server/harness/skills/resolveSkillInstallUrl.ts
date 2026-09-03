const BRANCHES = ["main", "master"] as const;

/** skills.sh slug may differ from the folder name on disk (e.g. vercel-react-best-practices → react-best-practices). */
export function skillFolderNameCandidates(skillId: string): string[] {
  const candidates = [skillId];
  if (skillId.startsWith("vercel-")) {
    candidates.push(skillId.slice("vercel-".length));
  }
  return [...new Set(candidates)];
}

function skillPathCandidates(folderName: string): string[] {
  return [
    `skills/${folderName}/SKILL.md`,
    `${folderName}/SKILL.md`,
    `.cursor/skills/${folderName}/SKILL.md`,
    `.claude/skills/${folderName}/SKILL.md`,
    `packages/${folderName}/SKILL.md`,
  ];
}

export function buildSkillInstallUrlCandidates(
  source: string,
  skillId: string,
): string[] {
  const segments = source.split("/").filter(Boolean);
  if (segments.length < 2) return [];
  const owner = segments[0]!;
  const repo = segments[1]!;
  const urls: string[] = [];
  for (const folderName of skillFolderNameCandidates(skillId)) {
    for (const branch of BRANCHES) {
      for (const path of skillPathCandidates(folderName)) {
        urls.push(
          `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`,
        );
      }
    }
  }
  return [...new Set(urls)];
}
export function parseOwnerRepo(source: string): { owner: string; repo: string } | null {
  const segments = source.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  return { owner: segments[0]!, repo: segments[1]! };
}

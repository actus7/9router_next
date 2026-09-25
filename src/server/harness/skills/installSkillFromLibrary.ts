import "server-only";

import { upsertAgentSkillRow } from "@/lib/db/repos/agentSkillsRepo";
import { safePublicFetch } from "@/server/security/safeFetch";
import { invalidateSkillTreeCache } from "@/server/harness/skills/context";
import {
  parseSkillMarkdown,
  validateSkillFields,
} from "@/server/harness/skills/parseSkillMarkdown";
import {
  buildSkillInstallUrlCandidates,
  parseOwnerRepo,
} from "@/server/harness/skills/resolveSkillInstallUrl";

const MAX_IMPORT_BYTES = 128 * 1024;
// Locating a SKILL.md means probing candidate paths and, failing that, walking
// the repo's SKILL.md tree — one request each. These two bound what a single
// install request can spend upstream, whatever shape the remote repo has.
const MAX_INSTALL_MS = 25_000;
const MAX_SCANNED_FOLDERS = 12;

interface GitHubTreeEntry {
  path: string;
  type: string;
}

function isValidSkillMarkdown(text: string): boolean {
  try {
    parseSkillMarkdown(text);
    return true;
  } catch {
    return false;
  }
}

async function fetchSkillMarkdownFromUrl(url: string): Promise<string | null> {
  try {
    const response = await safePublicFetch(url, {
      destinationPolicy: "public-only",
      timeoutMs: 12_000,
    });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMPORT_BYTES) return null;
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    return isValidSkillMarkdown(text) ? text : null;
  } catch {
    return null;
  }
}

/**
 * Fallback when the fixed paths miss: slug ≠ folder name, or the repo nests
 * skills under category folders (mattpocock/skills: skills/<category>/<name>).
 * One recursive tree request lists every SKILL.md at any depth.
 */
async function discoverSkillMarkdownViaGithub(
  source: string,
  skillId: string,
  deadline: number,
): Promise<{ raw: string; url: string } | null> {
  const ownerRepo = parseOwnerRepo(source);
  if (!ownerRepo) return null;

  for (const branch of ["main", "master"] as const) {
    if (Date.now() > deadline) return null;
    const treeUrl = `https://api.github.com/repos/${ownerRepo.owner}/${ownerRepo.repo}/git/trees/${branch}?recursive=1`;
    let tree: GitHubTreeEntry[];
    try {
      const response = await safePublicFetch(treeUrl, {
        destinationPolicy: "public-only",
        timeoutMs: 12_000,
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "modelhub-skill-installer",
        },
      });
      if (!response.ok) continue;
      const payload = (await response.json()) as { tree?: unknown };
      if (!Array.isArray(payload.tree)) continue;
      tree = payload.tree as GitHubTreeEntry[];
    } catch {
      continue;
    }

    const folderOf = (path: string) => path.split("/").at(-2) ?? "";
    const skillFiles = tree.filter(
      (entry) => entry.type === "blob" && entry.path.endsWith("/SKILL.md"),
    );
    const preferred = skillFiles.filter((entry) =>
      folderOf(entry.path).endsWith(skillId),
    );
    const ordered = [
      ...preferred,
      ...skillFiles.filter((entry) => !preferred.includes(entry)),
    ].slice(0, MAX_SCANNED_FOLDERS);

    for (const file of ordered) {
      if (Date.now() > deadline) return null;
      const rawUrl = `https://raw.githubusercontent.com/${ownerRepo.owner}/${ownerRepo.repo}/${branch}/${file.path}`;
      const raw = await fetchSkillMarkdownFromUrl(rawUrl);
      if (!raw) continue;
      const parsed = parseSkillMarkdown(raw);
      if (parsed.name === skillId || folderOf(file.path) === skillId) {
        return { raw, url: rawUrl };
      }
    }
  }

  return null;
}
export async function installSkillFromLibrary(options: {
  source: string;
  skillId: string;
  enabled?: boolean;
}): Promise<{ ok: true; skillId: string; url: string } | { ok: false; error: string }> {
  const source = options.source.trim();
  const skillId = options.skillId.trim();
  if (!source || !skillId) {
    return { ok: false, error: "source and skillId are required" };
  }

  const candidates = buildSkillInstallUrlCandidates(source, skillId);
  if (candidates.length === 0) {
    return { ok: false, error: "invalid source repository" };
  }

  const deadline = Date.now() + MAX_INSTALL_MS;
  let resolvedUrl = "";
  let raw = "";
  for (const url of candidates) {
    if (Date.now() > deadline) break;
    const text = await fetchSkillMarkdownFromUrl(url);
    if (!text) continue;
    raw = text;
    resolvedUrl = url;
    break;
  }

  if (!raw) {
    const discovered = await discoverSkillMarkdownViaGithub(
      source,
      skillId,
      deadline,
    );
    if (discovered) {
      raw = discovered.raw;
      resolvedUrl = discovered.url;
    }
  }

  if (!raw) {
    return {
      ok: false,
      error: `Não foi possível localizar SKILL.md para ${source}@${skillId}`,
    };
  }

  let parsed;
  try {
    parsed = parseSkillMarkdown(raw);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid SKILL.md",
    };
  }

  const id = parsed.name.trim().toLowerCase();
  const errors = validateSkillFields({
    id,
    description: parsed.description,
    body: parsed.body,
  });
  if (errors.length) {
    return { ok: false, error: errors.map((entry) => entry.message).join("; ") };
  }

  await upsertAgentSkillRow({
    id,
    name: id,
    description: parsed.description,
    body: parsed.body,
    enabled: options.enabled ?? false,
    source: "imported",
    origin: resolvedUrl,
  });
  await invalidateSkillTreeCache();

  return { ok: true, skillId: id, url: resolvedUrl };
}

import "server-only";

import {
  deleteAgentSkillRow,
  getAgentSkillsRevision,
  listAgentSkillRows,
  upsertAgentSkillRow,
  type AgentSkillRow,
} from "@/lib/db/repos/agentSkillsRepo";
import {
  BUNDLE_SKILLS,
  BUNDLE_SKILL_IDS,
} from "@/shared/harness/bundleSkills";
import {
  composeSkills,
  setActiveSkillCatalog,
  type AgentSkillDefinition,
  type SkillPatchRow,
} from "@/shared/harness/agentSkills";

export interface SkillTreeState {
  revision: number;
  skills: AgentSkillDefinition[];
  diagnostics: ReturnType<typeof composeSkills>["diagnostics"];
}

let cachedState: SkillTreeState | null = null;
let cachedRevision = -1;

function rowToPatch(row: AgentSkillRow): SkillPatchRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    body: row.body,
    enabled: row.enabled,
    source: row.source,
    origin: row.origin,
  };
}

export async function reloadSkillTree(): Promise<SkillTreeState> {
  const revision = await getAgentSkillsRevision();
  if (cachedState && cachedRevision === revision) return cachedState;

  const patchRows = (await listAgentSkillRows()).map(rowToPatch);
  const { skills, diagnostics } = composeSkills(BUNDLE_SKILLS, patchRows);
  cachedRevision = revision;
  cachedState = { revision, skills, diagnostics };
  setActiveSkillCatalog({ skills });
  return cachedState;
}

export function getSkillTreeState(): SkillTreeState {
  if (!cachedState) {
    const { skills, diagnostics } = composeSkills(BUNDLE_SKILLS, []);
    cachedState = { revision: 0, skills, diagnostics };
    setActiveSkillCatalog({ skills });
  }
  return cachedState;
}

export function findComposedSkill(id: string): AgentSkillDefinition | undefined {
  return getSkillTreeState().skills.find((skill) => skill.id === id);
}

export function isBundledSkillId(id: string): boolean {
  return BUNDLE_SKILL_IDS.has(id);
}

export async function invalidateSkillTreeCache(): Promise<SkillTreeState> {
  cachedRevision = -1;
  cachedState = null;
  return reloadSkillTree();
}

export { upsertAgentSkillRow, deleteAgentSkillRow };

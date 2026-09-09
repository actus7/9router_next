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
import { currentTenantId } from "@/lib/db/tenant";

export interface SkillTreeState {
  revision: number;
  skills: AgentSkillDefinition[];
  diagnostics: ReturnType<typeof composeSkills>["diagnostics"];
}

/**
 * Composed skill trees, keyed by account.
 *
 * It used to be one module-level pair. `getAgentSkillsRevision()` is a
 * per-account counter that starts at 0, so two accounts sitting on the same
 * revision — the common case, since everyone starts there — collided: the
 * second one got the first one's cached tree, custom skill bodies and all,
 * straight out of `GET /api/harness/skills`.
 */
const cachedStates: Map<string, SkillTreeState> = new Map();

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
  const tenantId: string = currentTenantId();
  const revision = await getAgentSkillsRevision();
  const cached: SkillTreeState | undefined = cachedStates.get(tenantId);
  if (cached && cached.revision === revision) {
    setActiveSkillCatalog({ skills: cached.skills });
    return cached;
  }

  const patchRows = (await listAgentSkillRows()).map(rowToPatch);
  const { skills, diagnostics } = composeSkills(BUNDLE_SKILLS, patchRows);
  const state: SkillTreeState = { revision, skills, diagnostics };
  cachedStates.set(tenantId, state);
  setActiveSkillCatalog({ skills });
  return state;
}

export function getSkillTreeState(): SkillTreeState {
  const tenantId: string = currentTenantId();
  const cached: SkillTreeState | undefined = cachedStates.get(tenantId);
  if (cached) return cached;

  const { skills, diagnostics } = composeSkills(BUNDLE_SKILLS, []);
  const state: SkillTreeState = { revision: 0, skills, diagnostics };
  cachedStates.set(tenantId, state);
  setActiveSkillCatalog({ skills });
  return state;
}

export function findComposedSkill(id: string): AgentSkillDefinition | undefined {
  return getSkillTreeState().skills.find((skill) => skill.id === id);
}

export function isBundledSkillId(id: string): boolean {
  return BUNDLE_SKILL_IDS.has(id);
}

export async function invalidateSkillTreeCache(): Promise<SkillTreeState> {
  cachedStates.delete(currentTenantId());
  return reloadSkillTree();
}

export { upsertAgentSkillRow, deleteAgentSkillRow };

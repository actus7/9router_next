import "server-only";

import { listAgentSkillRows } from "@/lib/db/repos/agentSkillsRepo";
import { BUNDLE_SKILLS } from "@/shared/harness/bundleSkills";
import { composeSkills } from "@/shared/harness/agentSkills";

/**
 * The system-prompt block for the skills an API key asked for.
 *
 * Full bodies, not the chat's descriptions-plus-`load_skill`: the chat's
 * harness answers that tool call itself, but on the public API the caller
 * executes tools, and the gateway cannot answer a call the client never
 * declared. So a key that selects a skill pays for its whole body on every
 * request — which the Endpoint screen says next to the checkbox.
 *
 * Composed from the account's own rows (tenant-scoped repo), independently of
 * the chat's in-memory catalog.
 */
export async function buildGatewaySkillsPrompt(skillIds: readonly string[]): Promise<string> {
  if (skillIds.length === 0) return "";
  const rows = await listAgentSkillRows();
  const { skills } = composeSkills(BUNDLE_SKILLS, rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    body: row.body,
    enabled: row.enabled,
    source: row.source,
    origin: row.origin,
  })));
  const wanted = new Set(skillIds);
  // A selected skill that was since uninstalled is skipped, not an error.
  const selected = skills.filter((skill) => wanted.has(skill.id) && skill.body.trim());
  if (selected.length === 0) return "";
  return [
    "Agent Skills enabled for this API key. Follow a skill's instructions whenever the request matches its description.",
    ...selected.map((skill) => `<skill id="${skill.id}">\n# ${skill.name}\n${skill.description.trim()}\n\n${skill.body.trim()}\n</skill>`),
  ].join("\n\n");
}

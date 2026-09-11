import "server-only";

import { reloadSkillTree } from "@/server/harness/skills/context";
import { listAgentSkillFiles } from "@/lib/db/repos/agentSkillFilesRepo";
import { applyMemoryWrite } from "@/server/harness/memory/applyMemoryWrite";
import { applyPluginToggle, proposeHarnessCapability } from "@/server/harness/governance/applyPluginWrite";
import { searchPastSessionMessages } from "@/lib/db/repos/harnessMessageIndexRepo";
import { writeSkill } from "@/server/harness/skills/writeSkill";
import { validateSkillFields } from "@/server/harness/skills/parseSkillMarkdown";
import { sessionHasPlugin } from "./sessionCapability";

/**
 * The harness's own tools, running in the durable worker.
 *
 * They went through `/api/harness/*` from the browser, and those routes all
 * begin with `requireDashboardAccess()` — a worker has no dashboard session, so
 * the HTTP shape is not available to it at all. Calling the domain underneath
 * is what makes them reachable, and it is also more honest: tenancy is already
 * established by the run's `withTenant(owner)`, so there is nothing left for a
 * session check to add.
 *
 * The approval gate is preserved by construction rather than by a label: every
 * write here passes `"agent"`, so `skillWriteApproval` / `memoryWriteApproval`
 * queue it exactly as they did for the browser. Nothing an agent writes gets
 * quieter by having moved.
 */

const MAX_RESULT_CHARS = 30_000;

export interface HarnessToolContext {
  sessionId: string;
  /** Skills the session enabled, so a disabled one stays unreadable. */
  enabledSkillIds?: ReadonlySet<string>;
}

/** Tool names this module executes. */
export const SERVER_HARNESS_TOOLS: ReadonlySet<string> = new Set([
  "load_skill",
  "load_skill_file",
  "create_skill",
  "update_skill",
  "patch_skill",
  "learn_skill",
  "memory_add",
  "memory_replace",
  "memory_remove",
  "search_past_sessions",
  "toggle_plugin",
  "propose_harness_capability",
]);

function failure(error: string): string {
  return JSON.stringify({ ok: false, error });
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function slug(value: unknown): string {
  return text(value).toLowerCase();
}

/**
 * Finds a composed skill, reloading the tree first.
 *
 * The cached lookup reads a per-account cache, and in a worker that cache is
 * cold: it answers from the bundle defaults alone, so every skill the account
 * actually wrote would come back "not found". `reloadSkillTree` short-circuits
 * when the stored revision has not moved, so this costs one query on a cold
 * process and nothing on a warm one.
 */
async function composedSkill(id: string) {
  const { skills } = await reloadSkillTree();
  return skills.find((skill) => skill.id === id);
}

/** Skill writes carry the agent's origin, so the gate sees them as it should. */
async function agentSkillWrite(
  id: string,
  fields: { name: string; description: string; body: string; enabled: boolean },
  action: string,
): Promise<string> {
  const invalid = validateSkillFields({ id, ...fields });
  if (invalid.length > 0) {
    return failure(invalid.map((issue) => `${issue.field}: ${issue.message}`).join("; "));
  }
  const outcome = await writeSkill({
    row: { id, ...fields, source: "user", origin: "agent" } as Parameters<typeof writeSkill>[0]["row"],
    files: [],
    initiator: "agent",
    action,
  });
  return JSON.stringify(
    outcome.pending
      ? { ok: true, name: id, pending: true, pendingId: outcome.pendingId, message: "Skill write queued for user approval" }
      : { ok: true, name: id, message: `Skill ${action}d` },
  );
}

/** Returns the tool result, or null when `name` is not a harness tool. */
export async function executeHarnessToolServerSide(
  name: string,
  args: Record<string, unknown>,
  context: HarnessToolContext,
): Promise<string | null> {
  if (!SERVER_HARNESS_TOOLS.has(name)) return null;

  if (name === "load_skill" || name === "load_skill_file") {
    const skillId = slug(args.name);
    if (!skillId) return failure(`${name} requires name`);
    if (context.enabledSkillIds && !context.enabledSkillIds.has(skillId)) {
      return failure(`Skill not enabled in this session: ${skillId}`);
    }
    const skill = await composedSkill(skillId);
    if (!skill) return failure("Skill not found");

    if (name === "load_skill") {
      const files = await listAgentSkillFiles(skillId).catch(() => []);
      return JSON.stringify({
        ok: true,
        name: skillId,
        description: skill.description ?? "",
        body: String(skill.body ?? "").slice(0, MAX_RESULT_CHARS),
        files: files.map((file) => file.filePath),
      });
    }

    const path = slug(args.path);
    if (!path) return failure("load_skill_file requires name and path");
    const files = await listAgentSkillFiles(skillId).catch(() => []);
    const file = files.find((candidate) => candidate.filePath.toLowerCase() === path);
    if (!file?.content) return failure("Skill file not found");
    return JSON.stringify({
      ok: true,
      name: skillId,
      path,
      content: file.content.slice(0, MAX_RESULT_CHARS),
    });
  }

  if (name === "create_skill" || name === "update_skill") {
    const id = slug(args.name);
    const description = text(args.description);
    const body = text(args.body);
    if (!id) return failure(`${name} requires name`);
    if (name === "create_skill" && (!description || !body)) {
      return failure("create_skill requires name, description, and body");
    }
    const existing = name === "update_skill" ? await composedSkill(id) : undefined;
    if (name === "update_skill" && !existing) return failure("Skill not found");
    if (existing?.bundled) return failure("Bundled skills cannot be edited via update_skill");
    return await agentSkillWrite(
      id,
      {
        name: id,
        description: description || String(existing?.description ?? ""),
        body: body || String(existing?.body ?? ""),
        enabled: typeof args.enabled === "boolean" ? args.enabled : existing?.enabled !== false,
      },
      name === "create_skill" ? "create" : "update",
    );
  }

  if (name === "patch_skill" || name === "learn_skill") {
    const id = slug(args.name);
    if (!id) return failure(`${name} requires name`);

    if (name === "learn_skill") {
      const lesson = text(args.lesson) || text(args.body);
      if (!lesson) return failure("learn_skill requires a lesson");
      return await agentSkillWrite(
        id,
        {
          name: id,
          description: text(args.description) || id,
          body: `# ${id}\n\n${lesson}`,
          enabled: true,
        },
        "learn",
      );
    }

    const patch = text(args.patch);
    if (!patch) return failure("patch_skill requires name and patch");
    const existing = await composedSkill(id);
    if (!existing) return failure("Skill not found");
    if (existing.bundled) return failure("Bundled skills cannot be edited via patch_skill");
    const current = String(existing.body ?? "");
    const body = args.mode === "replace" ? patch : `${current}\n\n${patch}`;
    return await agentSkillWrite(
      id,
      {
        name: id,
        description: String(existing.description ?? id),
        body,
        enabled: existing.enabled !== false,
      },
      "patch",
    );
  }

  if (name === "memory_add" || name === "memory_replace" || name === "memory_remove") {
    // The account's memory is shared by every conversation, so whether a
    // conversation may write to it is the server's call, not the browser's.
    if (!(await sessionHasPlugin(context.sessionId, "tool-memory"))) {
      return failure("The Memory plugin (tool-memory) is not enabled for this conversation");
    }
    const action = name === "memory_add" ? "add" : name === "memory_replace" ? "replace" : "remove";
    const scope = args.scope === "user" ? "user" : args.scope === "agent" ? "agent" : undefined;
    const id = text(args.id) || undefined;
    const content = text(args.content) || undefined;
    if (action === "add" && (!scope || !content)) return failure("memory_add requires scope and content");
    if ((action === "replace" || action === "remove") && !id) return failure(`${name} requires id`);
    if (action === "replace" && !content) return failure("memory_replace requires content");

    const result = await applyMemoryWrite({ action, scope, id, content, source: "agent" });
    if (!result.ok) return failure(typeof result.error === "string" ? result.error : "Memory write failed");
    return JSON.stringify({
      ok: true,
      pending: result.pending === true,
      pendingId: result.pendingId,
      entry: result.entry,
      message: result.pending ? "Write queued for user approval" : "Memory updated",
    });
  }

  if (name === "search_past_sessions") {
    const query = text(args.query);
    if (!query) return failure("search_past_sessions requires query");
    const results = await searchPastSessionMessages({
      query,
      limit: typeof args.max_results === "number" ? Math.floor(args.max_results) : undefined,
      excludeSessionId: text(args.exclude_session_id) || context.sessionId,
    }).catch(() => null);
    if (!results) return failure("Session search failed");
    return JSON.stringify({ ok: true, results });
  }

  if (name === "toggle_plugin") {
    if (!(await sessionHasPlugin(context.sessionId, "tool-harness-governance"))) {
      return failure("The Governance plugin (tool-harness-governance) is not enabled for this conversation");
    }
    const pluginId = text(args.plugin_id);
    if (!pluginId || typeof args.enabled !== "boolean") {
      return failure("toggle_plugin requires plugin_id and enabled");
    }
    const result = await applyPluginToggle({ pluginId, enabled: args.enabled, source: "agent" });
    if (!result.ok) return failure(typeof result.error === "string" ? result.error : "Plugin toggle failed");
    return JSON.stringify({ ...result, ok: true });
  }

  if (!(await sessionHasPlugin(context.sessionId, "tool-harness-governance"))) {
    return failure("The Governance plugin (tool-harness-governance) is not enabled for this conversation");
  }
  const title = text(args.title);
  const description = text(args.description);
  if (!title || !description) {
    return failure("propose_harness_capability requires title and description");
  }
  const proposal = await proposeHarnessCapability({
    title,
    description,
    toolName: text(args.tool_name),
  });
  if (!proposal.ok) {
    return failure(typeof proposal.error === "string" ? proposal.error : "Proposal failed");
  }
  return JSON.stringify({ ...proposal, ok: true });
}

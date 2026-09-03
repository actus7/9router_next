import type { ToolCall } from "../types";
import { setActiveSkillCatalog } from "@/shared/harness/agentSkills";
import { MAX_RESULT_CHARS, type RuntimeToolContext } from "./runtimeToolProviders";

export type HarnessToolArguments = {
  query?: unknown;
  max_results?: unknown;
  name?: unknown;
  description?: unknown;
  body?: unknown;
  enabled?: unknown;
  scope?: unknown;
  id?: unknown;
  content?: unknown;
  exclude_session_id?: unknown;
  path?: unknown;
  patch?: unknown;
  mode?: unknown;
  lesson?: unknown;
  plugin_id?: unknown;
  tool_name?: unknown;
  title?: unknown;
};

const HARNESS_TOOL_NAMES = new Set([
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

export function isHarnessTool(name: string): boolean {
  return HARNESS_TOOL_NAMES.has(name);
}

export async function tryExecuteHarnessToolCall(
  call: ToolCall,
  context: RuntimeToolContext,
  arguments_: HarnessToolArguments,
  signal: AbortSignal,
): Promise<string | null> {
  if (!isHarnessTool(call.name)) return null;

  if (call.name === "load_skill") {
    const skillId =
      typeof arguments_.name === "string"
        ? arguments_.name.trim().toLowerCase()
        : "";
    if (!skillId) {
      return JSON.stringify({ ok: false, error: "load_skill requires name" });
    }
    if (context.enabledSkillIds && !context.enabledSkillIds.has(skillId)) {
      return JSON.stringify({
        ok: false,
        error: `Skill not enabled in this session: ${skillId}`,
      });
    }
    const response = await fetch(
      `/api/harness/skills?id=${encodeURIComponent(skillId)}`,
      { signal },
    );
    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      skill?: { id?: string; body?: string; description?: string };
      error?: unknown;
    } | null;
    if (!response.ok || !payload?.skill?.body) {
      return JSON.stringify({
        ok: false,
        error:
          typeof payload?.error === "string"
            ? payload.error
            : "Skill not found",
      });
    }
    context.onSkillEvent?.("skill/load", { name: skillId });
    return JSON.stringify({
      ok: true,
      name: skillId,
      description: payload.skill.description ?? "",
      body: payload.skill.body.slice(0, MAX_RESULT_CHARS),
      files: Array.isArray((payload.skill as { files?: unknown }).files)
        ? (payload.skill as { files: unknown[] }).files
        : [],
    });
  }

  if (call.name === "load_skill_file") {
    const skillId =
      typeof arguments_.name === "string"
        ? arguments_.name.trim().toLowerCase()
        : "";
    const path =
      typeof arguments_.path === "string"
        ? arguments_.path.trim().toLowerCase()
        : "";
    if (!skillId || !path) {
      return JSON.stringify({
        ok: false,
        error: "load_skill_file requires name and path",
      });
    }
    if (context.enabledSkillIds && !context.enabledSkillIds.has(skillId)) {
      return JSON.stringify({
        ok: false,
        error: `Skill not enabled in this session: ${skillId}`,
      });
    }
    const response = await fetch(
      `/api/harness/skills?id=${encodeURIComponent(skillId)}&file=${encodeURIComponent(path)}`,
      { signal },
    );
    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      file?: { content?: string; filePath?: string };
      error?: unknown;
    } | null;
    if (!response.ok || !payload?.file?.content) {
      return JSON.stringify({
        ok: false,
        error:
          typeof payload?.error === "string"
            ? payload.error
            : "Skill file not found",
      });
    }
    context.onSkillEvent?.("skill/load", { name: skillId, path });
    return JSON.stringify({
      ok: true,
      name: skillId,
      path,
      content: payload.file.content.slice(0, MAX_RESULT_CHARS),
    });
  }

  if (call.name === "create_skill") {
    const name =
      typeof arguments_.name === "string"
        ? arguments_.name.trim().toLowerCase()
        : "";
    const description =
      typeof arguments_.description === "string"
        ? arguments_.description.trim()
        : "";
    const body =
      typeof arguments_.body === "string" ? arguments_.body.trim() : "";
    if (!name || !description || !body) {
      return JSON.stringify({
        ok: false,
        error: "create_skill requires name, description, and body",
      });
    }
    const response = await fetch("/api/harness/skills", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: name, name, description, body, enabled: true }),
      signal,
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: unknown;
    } | null;
    if (!response.ok) {
      return JSON.stringify({
        ok: false,
        error:
          typeof payload?.error === "string"
            ? payload.error
            : "Failed to create skill",
      });
    }
    const catalogPayload = (await fetch("/api/harness/skills", { signal })
      .then((r) => r.json())
      .catch(() => null)) as { skills?: unknown[] } | null;
    if (catalogPayload?.skills?.length) {
      setActiveSkillCatalog({
        skills: catalogPayload.skills as Parameters<
          typeof setActiveSkillCatalog
        >[0]["skills"],
      });
    }
    context.onSkillEvent?.("skill/created", { name, description });
    return JSON.stringify({ ok: true, name, message: "Skill created" });
  }

  if (call.name === "update_skill") {
    const name =
      typeof arguments_.name === "string"
        ? arguments_.name.trim().toLowerCase()
        : "";
    if (!name) {
      return JSON.stringify({ ok: false, error: "update_skill requires name" });
    }
    const existingResponse = await fetch(
      `/api/harness/skills?id=${encodeURIComponent(name)}`,
      { signal },
    );
    const existingPayload = (await existingResponse.json().catch(() => null)) as {
      skill?: {
        id?: string;
        description?: string;
        body?: string;
        enabled?: boolean;
        bundled?: boolean;
      };
      error?: unknown;
    } | null;
    if (!existingResponse.ok || !existingPayload?.skill) {
      return JSON.stringify({
        ok: false,
        error: "Skill not found",
      });
    }
    if (existingPayload.skill.bundled) {
      return JSON.stringify({
        ok: false,
        error: "Bundled skills cannot be edited via update_skill",
      });
    }
    const description =
      typeof arguments_.description === "string"
        ? arguments_.description.trim()
        : existingPayload.skill.description ?? "";
    const body =
      typeof arguments_.body === "string"
        ? arguments_.body.trim()
        : existingPayload.skill.body ?? "";
    const enabled =
      typeof arguments_.enabled === "boolean"
        ? arguments_.enabled
        : existingPayload.skill.enabled !== false;
    const response = await fetch("/api/harness/skills", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: name, name, description, body, enabled }),
      signal,
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: unknown;
    } | null;
    if (!response.ok) {
      return JSON.stringify({
        ok: false,
        error:
          typeof payload?.error === "string"
            ? payload.error
            : "Failed to update skill",
      });
    }
    const catalogPayload = (await fetch("/api/harness/skills", { signal })
      .then((r) => r.json())
      .catch(() => null)) as { skills?: unknown[] } | null;
    if (catalogPayload?.skills?.length) {
      setActiveSkillCatalog({
        skills: catalogPayload.skills as Parameters<
          typeof setActiveSkillCatalog
        >[0]["skills"],
      });
    }
    context.onSkillEvent?.("skill/updated", { name });
    return JSON.stringify({ ok: true, name, message: "Skill updated" });
  }

  if (call.name === "patch_skill") {
    const name =
      typeof arguments_.name === "string"
        ? arguments_.name.trim().toLowerCase()
        : "";
    const patch =
      typeof arguments_.patch === "string" ? arguments_.patch.trim() : "";
    const mode = arguments_.mode === "replace" ? "replace" : "append";
    if (!name || !patch) {
      return JSON.stringify({
        ok: false,
        error: "patch_skill requires name and patch",
      });
    }
    const existingResponse = await fetch(
      `/api/harness/skills?id=${encodeURIComponent(name)}`,
      { signal },
    );
    const existingPayload = (await existingResponse.json().catch(() => null)) as {
      skill?: { body?: string; description?: string; bundled?: boolean };
    } | null;
    if (!existingResponse.ok || !existingPayload?.skill) {
      return JSON.stringify({ ok: false, error: "Skill not found" });
    }
    if (existingPayload.skill.bundled) {
      return JSON.stringify({
        ok: false,
        error: "Bundled skills cannot be patched",
      });
    }
    const body =
      mode === "replace"
        ? patch
        : `${existingPayload.skill.body ?? ""}\n\n${patch}`.trim();
    const response = await fetch("/api/harness/skills", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: name,
        name,
        description: existingPayload.skill.description ?? name,
        body,
        enabled: true,
      }),
      signal,
    });
    if (!response.ok) {
      return JSON.stringify({ ok: false, error: "Failed to patch skill" });
    }
    context.onSkillEvent?.("skill/updated", { name, mode: "patch" });
    return JSON.stringify({ ok: true, name, message: "Skill patched" });
  }

  if (call.name === "learn_skill") {
    const name =
      typeof arguments_.name === "string"
        ? arguments_.name.trim().toLowerCase()
        : "";
    const description =
      typeof arguments_.description === "string"
        ? arguments_.description.trim()
        : "";
    const lesson =
      typeof arguments_.lesson === "string" ? arguments_.lesson.trim() : "";
    if (!name || !description || !lesson) {
      return JSON.stringify({
        ok: false,
        error: "learn_skill requires name, description, and lesson",
      });
    }
    const response = await fetch("/api/harness/skills", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: name,
        name,
        description,
        body: `# ${name}\n\n${lesson}`,
        enabled: true,
      }),
      signal,
    });
    if (!response.ok) {
      return JSON.stringify({ ok: false, error: "Failed to learn skill" });
    }
    context.onSkillEvent?.("skill/created", { name, source: "learn_skill" });
    return JSON.stringify({ ok: true, name, message: "Skill learned" });
  }

  if (
    call.name === "memory_add" ||
    call.name === "memory_replace" ||
    call.name === "memory_remove"
  ) {
    const action =
      call.name === "memory_add"
        ? "add"
        : call.name === "memory_replace"
          ? "replace"
          : "remove";
    const scope =
      arguments_.scope === "user"
        ? "user"
        : arguments_.scope === "agent"
          ? "agent"
          : undefined;
    const id =
      typeof arguments_.id === "string" ? arguments_.id.trim() : undefined;
    const content =
      typeof arguments_.content === "string"
        ? arguments_.content.trim()
        : undefined;
    if (action === "add" && (!scope || !content)) {
      return JSON.stringify({
        ok: false,
        error: "memory_add requires scope and content",
      });
    }
    if ((action === "replace" || action === "remove") && !id) {
      return JSON.stringify({
        ok: false,
        error: `${call.name} requires id`,
      });
    }
    if (action === "replace" && !content) {
      return JSON.stringify({
        ok: false,
        error: "memory_replace requires content",
      });
    }
    const response = await fetch("/api/harness/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, scope, id, content, source: "agent" }),
      signal,
    });
    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      pending?: boolean;
      pendingId?: string;
      entry?: { id?: string };
      error?: unknown;
    } | null;
    if (!response.ok || !payload?.ok) {
      return JSON.stringify({
        ok: false,
        error:
          typeof payload?.error === "string"
            ? payload.error
            : "Memory write failed",
      });
    }
    context.onMemoryEvent?.(`memory/${action}`, {
      scope,
      id: id ?? payload.entry?.id,
      pending: payload.pending === true,
      pendingId: payload.pendingId,
    });
    return JSON.stringify({
      ok: true,
      pending: payload.pending === true,
      pendingId: payload.pendingId,
      entry: payload.entry,
      message: payload.pending
        ? "Write queued for user approval"
        : "Memory updated",
    });
  }

  if (call.name === "search_past_sessions") {
    const query =
      typeof arguments_.query === "string" ? arguments_.query.trim() : "";
    if (!query) {
      return JSON.stringify({
        ok: false,
        error: "search_past_sessions requires query",
      });
    }
    const response = await fetch("/api/harness/search/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query,
        max_results:
          typeof arguments_.max_results === "number"
            ? arguments_.max_results
            : undefined,
        exclude_session_id:
          typeof arguments_.exclude_session_id === "string"
            ? arguments_.exclude_session_id
            : context.sessionId,
      }),
      signal,
    });
    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      results?: unknown;
      error?: unknown;
    } | null;
    if (!response.ok || !payload?.ok) {
      return JSON.stringify({
        ok: false,
        error:
          typeof payload?.error === "string"
            ? payload.error
            : "Session search failed",
      });
    }
    return JSON.stringify({ ok: true, results: payload.results ?? [] });
  }

  if (call.name === "toggle_plugin") {
    const pluginId =
      typeof arguments_.plugin_id === "string"
        ? arguments_.plugin_id.trim()
        : "";
    if (!pluginId || typeof arguments_.enabled !== "boolean") {
      return JSON.stringify({
        ok: false,
        error: "toggle_plugin requires plugin_id and enabled",
      });
    }
    const response = await fetch("/api/harness/governance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "toggle",
        plugin_id: pluginId,
        enabled: arguments_.enabled,
        source: "agent",
      }),
      signal,
    });
    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      pending?: boolean;
      error?: unknown;
    } | null;
    if (!response.ok || !payload?.ok) {
      return JSON.stringify({
        ok: false,
        error:
          typeof payload?.error === "string"
            ? payload.error
            : "Plugin toggle failed",
      });
    }
    return JSON.stringify({
      ok: true,
      pending: payload.pending === true,
      message: payload.pending
        ? "Plugin toggle queued for approval"
        : "Plugin toggled",
    });
  }

  if (call.name === "propose_harness_capability") {
    const title = typeof arguments_.title === "string" ? arguments_.title.trim() : "";
    const description =
      typeof arguments_.description === "string"
        ? arguments_.description.trim()
        : "";
    const toolName =
      typeof arguments_.tool_name === "string"
        ? arguments_.tool_name.trim()
        : "";
    if (!title || !description || !toolName) {
      return JSON.stringify({
        ok: false,
        error: "propose_harness_capability requires title, description, tool_name",
      });
    }
    const response = await fetch("/api/harness/governance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "propose",
        title,
        description,
        tool_name: toolName,
        source: "agent",
      }),
      signal,
    });
    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      pendingId?: string;
      error?: unknown;
    } | null;
    if (!response.ok || !payload?.ok) {
      return JSON.stringify({
        ok: false,
        error:
          typeof payload?.error === "string"
            ? payload.error
            : "Proposal failed",
      });
    }
    return JSON.stringify({
      ok: true,
      pendingId: payload.pendingId,
      message: "Capability proposal queued for approval",
    });
  }

  return null;
}

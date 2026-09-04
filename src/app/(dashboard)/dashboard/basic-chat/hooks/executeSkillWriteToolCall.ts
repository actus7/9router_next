"use client";

import type { ToolCall } from "../types";
import { setActiveSkillCatalog } from "@/shared/harness/agentSkills";
import type { RuntimeToolContext } from "./runtimeToolProviders";
import type { HarnessToolArguments } from "./executeHarnessToolCall";

/**
 * The four tools that let the agent write a skill.
 *
 * Split out of executeHarnessToolCall so that file stays inside the project's
 * 600-line ceiling, and because these four share one concern the read-side
 * tools do not: every one of them can come back queued for operator approval
 * rather than applied.
 */

export const SKILL_WRITE_TOOL_NAMES = new Set([
  "create_skill",
  "update_skill",
  "patch_skill",
  "learn_skill",
]);

/**
 * The skills route queues an agent-initiated write for operator approval when
 * `skillWriteApproval` is on. The agent has to be told the skill does not exist
 * yet — reporting "created" would make it act on an instruction that is still
 * sitting in the review queue.
 */
async function readSkillWriteOutcome(
  response: Response,
): Promise<{ pending: boolean; pendingId?: string }> {
  const payload = (await response.clone().json().catch(() => null)) as {
    pending?: boolean;
    pendingId?: string;
  } | null;
  return { pending: payload?.pending === true, pendingId: payload?.pendingId };
}

/** Returns the tool result, or null when `call` is not a skill-write tool. */
export async function trySkillWriteToolCall(
  call: ToolCall,
  context: RuntimeToolContext,
  arguments_: HarnessToolArguments,
  signal: AbortSignal,
): Promise<string | null> {
  if (!SKILL_WRITE_TOOL_NAMES.has(call.name)) return null;

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
      body: JSON.stringify({ id: name, name, description, body, enabled: true, initiator: "agent", action: "create" }),
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
    const created = await readSkillWriteOutcome(response);
    if (created.pending) {
      context.onSkillEvent?.("skill/queued", { name, pendingId: created.pendingId });
      return JSON.stringify({ ok: true, name, pending: true, pendingId: created.pendingId, message: "Skill write queued for user approval" });
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
      body: JSON.stringify({ id: name, name, description, body, enabled, initiator: "agent", action: "update" }),
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
    const updated = await readSkillWriteOutcome(response);
    if (updated.pending) {
      context.onSkillEvent?.("skill/queued", { name, pendingId: updated.pendingId });
      return JSON.stringify({ ok: true, name, pending: true, pendingId: updated.pendingId, message: "Skill write queued for user approval" });
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
        initiator: "agent",
        action: "patch",
      }),
      signal,
    });
    if (!response.ok) {
      return JSON.stringify({ ok: false, error: "Failed to patch skill" });
    }
    const patched = await readSkillWriteOutcome(response);
    if (patched.pending) {
      context.onSkillEvent?.("skill/queued", { name, pendingId: patched.pendingId, mode: "patch" });
      return JSON.stringify({ ok: true, name, pending: true, pendingId: patched.pendingId, message: "Skill write queued for user approval" });
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
        initiator: "agent",
        action: "learn",
      }),
      signal,
    });
    if (!response.ok) {
      return JSON.stringify({ ok: false, error: "Failed to learn skill" });
    }
    const learned = await readSkillWriteOutcome(response);
    if (learned.pending) {
      context.onSkillEvent?.("skill/queued", { name, pendingId: learned.pendingId, source: "learn_skill" });
      return JSON.stringify({ ok: true, name, pending: true, pendingId: learned.pendingId, message: "Skill write queued for user approval" });
    }
    context.onSkillEvent?.("skill/created", { name, source: "learn_skill" });
    return JSON.stringify({ ok: true, name, message: "Skill learned" });
  }

  return null;
}

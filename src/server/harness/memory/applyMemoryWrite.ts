import "server-only";

import { randomUUID } from "node:crypto";
import {
  deleteAgentMemoryEntry,
  getAgentMemoryRevision,
  insertAgentMemoryEntry,
  listAgentMemoryEntries,
  totalChars,
  updateAgentMemoryEntry,
  type AgentMemoryEntry,
  type MemoryScope,
} from "@/lib/db/repos/agentMemoryRepo";
import {
  getHarnessPendingWrite,
  insertHarnessPendingWrite,
  listHarnessPendingWrites,
  resolveHarnessPendingWrite,
  type PendingWriteKind,
} from "@/lib/db/repos/harnessPendingWritesRepo";
import { getHarnessLearningConfig } from "@/lib/db/repos/harnessLearningConfigRepo";
import {
  MEMORY_CHAR_LIMITS,
  MAX_MEMORY_ENTRY_CHARS,
  type AgentMemorySnapshot,
  type MemoryEntryView,
} from "@/shared/harness/agentMemory";
import { scanMemoryContent } from "./securityScan";

export type MemoryApplyAction = "add" | "replace" | "remove";
export type MemoryApplySource = "agent" | "ui" | "review";

export interface MemoryApplyRequest {
  action: MemoryApplyAction;
  scope?: MemoryScope;
  id?: string;
  content?: string;
  source: MemoryApplySource;
}

export interface MemoryApplyResult {
  ok: boolean;
  pending?: boolean;
  pendingId?: string;
  entry?: MemoryEntryView;
  error?: string;
  issues?: ReturnType<typeof scanMemoryContent>;
  kind?: PendingWriteKind;
  action?: string;
  outcome?: "applied" | "accepted_for_implementation" | "rejected";
}

function toView(entry: AgentMemoryEntry): MemoryEntryView {
  return {
    id: entry.id,
    scope: entry.scope,
    content: entry.content,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

export async function buildMemorySnapshot(): Promise<AgentMemorySnapshot> {
  const entries = await listAgentMemoryEntries();
  const agent = entries.filter((e) => e.scope === "agent").map(toView);
  const user = entries.filter((e) => e.scope === "user").map(toView);
  return {
    revision: await getAgentMemoryRevision(),
    agent,
    user,
    agentChars: totalChars(entries.filter((e) => e.scope === "agent")),
    userChars: totalChars(entries.filter((e) => e.scope === "user")),
    agentLimit: MEMORY_CHAR_LIMITS.agent,
    userLimit: MEMORY_CHAR_LIMITS.user,
  };
}

async function scopeEntries(scope: MemoryScope): Promise<AgentMemoryEntry[]> {
  return listAgentMemoryEntries(scope);
}

function wouldExceedLimit(
  scope: MemoryScope,
  entries: readonly AgentMemoryEntry[],
  delta: number,
): boolean {
  return totalChars(entries) + delta > MEMORY_CHAR_LIMITS[scope];
}

async function applyDirect(
  request: MemoryApplyRequest,
): Promise<MemoryApplyResult> {
  if (request.action === "add") {
    const scope = request.scope ?? "agent";
    const content = request.content?.trim() ?? "";
    const issues = scanMemoryContent(content);
    if (issues.length) return { ok: false, error: issues[0]!.message, issues };
    const entries = await scopeEntries(scope);
    if (wouldExceedLimit(scope, entries, content.length)) {
      return { ok: false, error: `Memory limit reached for scope ${scope}` };
    }
    const entry = await insertAgentMemoryEntry({
      id: randomUUID(),
      scope,
      content,
    });
    return { ok: true, entry: toView(entry) };
  }

  const id = request.id?.trim();
  if (!id) return { ok: false, error: "id is required" };

  const all = await listAgentMemoryEntries();
  const existing = all.find((entry) => entry.id === id);
  if (!existing && request.action !== "remove") {
    return { ok: false, error: "Memory entry not found" };
  }

  if (request.action === "remove") {
    if (!existing) return { ok: false, error: "Memory entry not found" };
    await deleteAgentMemoryEntry(id);
    return { ok: true, entry: toView(existing) };
  }

  const content = request.content?.trim() ?? "";
  const issues = scanMemoryContent(content);
  if (issues.length) return { ok: false, error: issues[0]!.message, issues };
  const scopeEntriesList = await scopeEntries(existing!.scope);
  const delta = content.length - existing!.content.length;
  if (wouldExceedLimit(existing!.scope, scopeEntriesList, delta)) {
    return { ok: false, error: `Memory limit reached for scope ${existing!.scope}` };
  }
  await updateAgentMemoryEntry(id, content);
  return {
    ok: true,
    entry: {
      ...toView(existing!),
      content,
      updatedAt: new Date().toISOString(),
    },
  };
}

export async function applyMemoryWrite(
  request: MemoryApplyRequest,
): Promise<MemoryApplyResult> {
  const config = await getHarnessLearningConfig();
  let scope = request.scope ?? "agent";
  if (request.action !== "add") {
    const id = request.id?.trim();
    if (!id) return { ok: false, error: "id is required" };
    const existing = (await listAgentMemoryEntries()).find((entry) => entry.id === id);
    if (!existing) return { ok: false, error: "Memory entry not found" };
    scope = existing.scope;
  }
  if (scope === "agent" && !config.memoryAgentEnabled) {
    return { ok: false, error: "Agent memory is disabled" };
  }
  if (scope === "user" && !config.memoryUserEnabled) {
    return { ok: false, error: "User memory is disabled" };
  }

  if (
    request.source === "agent" &&
    config.memoryWriteApproval &&
    request.action !== "remove"
  ) {
    const content = request.content?.trim() ?? "";
    if (request.action === "add" || request.action === "replace") {
      const issues = scanMemoryContent(content);
      if (issues.length) return { ok: false, error: issues[0]!.message, issues };
    }
    const pendingId = randomUUID();
    await insertHarnessPendingWrite({
      id: pendingId,
      kind: "memory",
      action: request.action,
      payload: {
        scope,
        id: request.id,
        content: request.content,
      },
      source: "agent",
    });
    return { ok: true, pending: true, pendingId };
  }

  if (
    request.source === "agent" &&
    config.memoryWriteApproval &&
    request.action === "remove"
  ) {
    const pendingId = randomUUID();
    await insertHarnessPendingWrite({
      id: pendingId,
      kind: "memory",
      action: "remove",
      payload: { scope, id: request.id },
      source: "agent",
    });
    return { ok: true, pending: true, pendingId };
  }

  return applyDirect({ ...request, scope });
}

export async function approvePendingWrite(id: string): Promise<MemoryApplyResult> {
  const pending = await getHarnessPendingWrite(id);
  if (!pending) return { ok: false, error: "Pending write not found" };
  if (pending.status !== "pending") return { ok: false, error: "Pending write already resolved" };
  if (pending.kind === "memory") {
    const payload = pending.payload;
    const result = await applyMemoryWrite({
      action: pending.action as MemoryApplyAction,
      scope: payload.scope === "user" ? "user" : "agent",
      id: typeof payload.id === "string" ? payload.id : undefined,
      content: typeof payload.content === "string" ? payload.content : undefined,
      source: "ui",
    });
    if (result.ok) {
      await resolveHarnessPendingWrite(id, "applied", { outcome: "applied" });
    }
    return { ...result, kind: "memory", action: pending.action, outcome: result.ok ? "applied" : undefined };
  }
  if (pending.kind === "plugin" && pending.action === "toggle") {
    const pluginId = typeof pending.payload.pluginId === "string" ? pending.payload.pluginId : "";
    const enabled = pending.payload.enabled !== false;
    const { applyPluginToggle } = await import("@/server/harness/governance/applyPluginWrite");
    const result = await applyPluginToggle({ pluginId, enabled, source: "ui" });
    if (result.ok) {
      await resolveHarnessPendingWrite(id, "applied", { outcome: "applied" });
    }
    return { ok: result.ok, error: result.error, kind: "plugin", action: "toggle", outcome: result.ok ? "applied" : undefined };
  }
  if (pending.kind === "skill") {
    // Applied here rather than by re-POSTing the skills route, so approval
    // writes exactly the payload that was reviewed — re-running the request
    // would re-read config and could take a different branch.
    const payload = pending.payload as {
      row?: Record<string, unknown>;
      files?: Array<{ filePath: string; content: string }>;
    };
    const row = payload.row;
    if (!row || typeof row.id !== "string") {
      return { ok: false, error: "Pending skill write has no usable payload" };
    }
    const { upsertAgentSkillRow } = await import("@/lib/db/repos/agentSkillsRepo");
    const { replaceAgentSkillFiles } = await import("@/lib/db/repos/agentSkillFilesRepo");
    await upsertAgentSkillRow(row as unknown as Parameters<typeof upsertAgentSkillRow>[0]);
    const files = Array.isArray(payload.files) ? payload.files : [];
    if (files.length > 0 && row.source !== "override") {
      await replaceAgentSkillFiles(row.id, files);
    }
    await resolveHarnessPendingWrite(id, "applied", { outcome: "applied" });
    return { ok: true, kind: "skill", action: pending.action, outcome: "applied" };
  }
  if (pending.kind === "plugin" && pending.action === "propose") {
    await resolveHarnessPendingWrite(id, "accepted", {
      outcome: "accepted_for_implementation",
      title: pending.payload.title,
      toolName: pending.payload.toolName,
    });
    return {
      ok: true,
      kind: "plugin",
      action: "propose",
      outcome: "accepted_for_implementation",
    };
  }
  return { ok: false, error: "Unsupported pending kind" };
}

export async function rejectPendingWrite(id: string): Promise<MemoryApplyResult> {
  const pending = await getHarnessPendingWrite(id);
  if (!pending) return { ok: false };
  if (pending.status !== "pending") return { ok: false, error: "Pending write already resolved" };
  await resolveHarnessPendingWrite(id, "rejected", { outcome: "rejected" });
  return { ok: true, kind: pending.kind, action: pending.action, outcome: "rejected" };
}

export async function listPendingWrites() {
  return listHarnessPendingWrites(undefined, "pending");
}

export { scanMemoryContent, MAX_MEMORY_ENTRY_CHARS };

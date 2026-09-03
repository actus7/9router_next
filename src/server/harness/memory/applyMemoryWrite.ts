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
  deleteHarnessPendingWrite,
  getHarnessPendingWrite,
  insertHarnessPendingWrite,
  listHarnessPendingWrites,
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
  const scope = request.scope ?? "agent";
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
        scope: request.scope,
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
      payload: { id: request.id },
      source: "agent",
    });
    return { ok: true, pending: true, pendingId };
  }

  return applyDirect(request);
}

export async function approvePendingWrite(id: string): Promise<MemoryApplyResult> {
  const pending = await getHarnessPendingWrite(id);
  if (!pending) return { ok: false, error: "Pending write not found" };
  if (pending.kind === "memory") {
    const payload = pending.payload;
    const result = await applyDirect({
      action: pending.action as MemoryApplyAction,
      scope: payload.scope === "user" ? "user" : "agent",
      id: typeof payload.id === "string" ? payload.id : undefined,
      content: typeof payload.content === "string" ? payload.content : undefined,
      source: "ui",
    });
    if (result.ok) await deleteHarnessPendingWrite(id);
    return result;
  }
  if (pending.kind === "plugin" && pending.action === "toggle") {
    const pluginId = typeof pending.payload.pluginId === "string" ? pending.payload.pluginId : "";
    const enabled = pending.payload.enabled !== false;
    const { applyPluginToggle } = await import("@/server/harness/governance/applyPluginWrite");
    const result = await applyPluginToggle({ pluginId, enabled, source: "ui" });
    if (result.ok) await deleteHarnessPendingWrite(id);
    return { ok: result.ok, error: result.error };
  }
  return { ok: false, error: "Unsupported pending kind" };
}

export async function rejectPendingWrite(id: string): Promise<{ ok: boolean }> {
  const pending = await getHarnessPendingWrite(id);
  if (!pending) return { ok: false };
  await deleteHarnessPendingWrite(id);
  return { ok: true };
}

export async function listPendingMemoryWrites() {
  return listHarnessPendingWrites("memory");
}

export { scanMemoryContent, MAX_MEMORY_ENTRY_CHARS };

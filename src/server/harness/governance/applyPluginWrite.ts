import "server-only";

import { randomUUID } from "node:crypto";
import { getHarnessLearningConfig } from "@/lib/db/repos/harnessLearningConfigRepo";
import {
  insertHarnessPendingWrite,
} from "@/lib/db/repos/harnessPendingWritesRepo";
import { upsertPluginRow } from "@/lib/db/repos/pluginRowsRepo";
import { HARNESS_PLUGINS } from "@/shared/harness/agentPlugins";
import { HARNESS_CAPABILITY } from "@/server/plugin-core/factories";
import { reloadPluginTree, bootstrap } from "@/server/plugin-core/context";

export async function applyPluginToggle(input: {
  pluginId: string;
  enabled: boolean;
  source: "agent" | "ui";
}): Promise<{ ok: boolean; pending?: boolean; pendingId?: string; error?: string }> {
  const plugin = HARNESS_PLUGINS.find((item) => item.id === input.pluginId);
  if (!plugin) return { ok: false, error: "Unknown plugin id" };

  // A global toggle reconfigures the harness for every session, so an
  // agent-initiated one always stages for approval. This is deliberately
  // independent of the memory write gate, which governs memory entries only.
  if (input.source === "agent") {
    const pendingId = randomUUID();
    await insertHarnessPendingWrite({
      id: pendingId,
      kind: "plugin",
      action: "toggle",
      payload: { pluginId: input.pluginId, enabled: input.enabled },
      source: "agent",
    });
    return { ok: true, pending: true, pendingId };
  }

  await upsertPluginRow({
    id: plugin.id,
    plugin: HARNESS_CAPABILITY,
    config: plugin as unknown as Record<string, unknown>,
    position: 0,
    enabled: input.enabled,
    source: "override",
  });
  const ctx = await bootstrap();
  await reloadPluginTree(ctx);
  return { ok: true };
}

export async function proposeHarnessCapability(input: {
  title: string;
  description: string;
  toolName: string;
  source: "agent" | "ui";
}): Promise<{ ok: boolean; pendingId?: string; error?: string }> {
  if (!input.title.trim() || !input.description.trim() || !input.toolName.trim()) {
    return { ok: false, error: "title, description, and toolName are required" };
  }
  const pendingId = randomUUID();
  await insertHarnessPendingWrite({
    id: pendingId,
    kind: "plugin",
    action: "propose",
    payload: {
      title: input.title,
      description: input.description,
      toolName: input.toolName,
    },
    source: input.source === "ui" ? "agent" : "agent",
  });
  return { ok: true, pendingId };
}

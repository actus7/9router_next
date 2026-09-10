import "server-only";

import { randomUUID } from "node:crypto";

import { getHarnessLearningConfig } from "@/lib/db/repos/harnessLearningConfigRepo";
import { insertHarnessPendingWrite } from "@/lib/db/repos/harnessPendingWritesRepo";
import { replaceAgentSkillFiles } from "@/lib/db/repos/agentSkillFilesRepo";
import type { AgentSkillRow } from "@/lib/db/repos/agentSkillsRepo";
import { invalidateSkillTreeCache, upsertAgentSkillRow } from "./context";

export interface SkillWriteOutcome {
  pending: boolean;
  pendingId?: string;
  state?: Awaited<ReturnType<typeof invalidateSkillTreeCache>>;
}

/**
 * Writes a skill, or queues it for approval — with no HTTP anywhere in sight.
 *
 * The durable worker runs the agent's tools now, and it has no dashboard
 * session, so it cannot go through the route: `requireDashboardAccess()` would
 * refuse it. The gate itself has to live below that line, or the worker would
 * either bypass it or be unable to write at all.
 *
 * An agent writing a skill is a bigger grant than an agent toggling a plugin,
 * which is always gated. `initiator` is distinct from `row.source`, which
 * describes the skill's provenance (bundle/override/user) rather than who asked
 * for the write. An operator editing a skill is the authority and is never
 * gated.
 */
export async function writeSkill({ row, files, initiator, action }: {
  row: AgentSkillRow;
  files: ReadonlyArray<{ filePath: string; content: string }>;
  initiator: "user" | "agent";
  action: string;
}): Promise<SkillWriteOutcome> {
  if (initiator === "agent") {
    const { skillWriteApproval } = await getHarnessLearningConfig();
    if (skillWriteApproval) {
      const pending = await insertHarnessPendingWrite({
        id: randomUUID(),
        kind: "skill",
        action,
        source: "agent",
        payload: { row, files },
      });
      return { pending: true, pendingId: pending.id };
    }
  }

  await upsertAgentSkillRow(row);
  if (files.length > 0 && row.source !== "override") {
    await replaceAgentSkillFiles(row.id, files.map((file) => ({
      filePath: file.filePath,
      content: file.content,
    })));
  }
  return { pending: false, state: await invalidateSkillTreeCache() };
}

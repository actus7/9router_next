import "server-only";

import { randomUUID } from "node:crypto";

import { getHarnessLearningConfig } from "@/lib/db/repos/harnessLearningConfigRepo";
import {
  assessWriteRisk,
  canAutoApplyWrite,
  queuePendingWrite,
  recordAutoAppliedWrite,
} from "@/server/harness/governance/queuePendingWrite";
import { replaceAgentSkillFiles } from "@/lib/db/repos/agentSkillFilesRepo";
import type { AgentSkillRow } from "@/lib/db/repos/agentSkillsRepo";
import type { NewHarnessPendingWrite } from "@/shared/harness/pendingWrites";
import { invalidateSkillTreeCache, upsertAgentSkillRow } from "./context";

export interface SkillWriteOutcome {
  pending: boolean;
  pendingId?: string;
  autoApplied?: boolean;
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
  let autoApplied = false;
  if (initiator === "agent") {
    const config = await getHarnessLearningConfig();
    if (config.skillWriteApproval) {
      const pendingWrite: NewHarnessPendingWrite = {
        id: randomUUID(),
        kind: "skill",
        action,
        source: "agent",
        payload: { row, files },
      };
      // The Jev score is the semantic defence here ("High: tries to override
      // instructions, exfiltrate data..."); the skill INSTALL scan is another
      // lane.
      const risk = await assessWriteRisk(pendingWrite);
      if (!canAutoApplyWrite(config.writeRiskMode, risk)) {
        const pending = await queuePendingWrite(pendingWrite, { risk });
        return { pending: true, pendingId: pending.id };
      }
      // Confidently Harmless/Low in auto mode: apply now and leave an
      // `auto_applied` row as the audit trail.
      await recordAutoAppliedWrite(pendingWrite, risk);
      autoApplied = true;
    }
  }

  await upsertAgentSkillRow(row);
  if (files.length > 0 && row.source !== "override") {
    await replaceAgentSkillFiles(row.id, files.map((file) => ({
      filePath: file.filePath,
      content: file.content,
    })));
  }
  return { pending: false, autoApplied, state: await invalidateSkillTreeCache() };
}

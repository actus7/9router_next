import "server-only";

import { insertHarnessPendingWrite } from "@/lib/db/repos/harnessPendingWritesRepo";
import { evaluateJev, isJevFeatureEnabled, JEV_MODEL } from "@/server/decisions/jev";
import type { HarnessPendingWrite, NewHarnessPendingWrite, PendingWriteRisk } from "@/shared/harness/pendingWrites";

// Every approval-gated write enters the queue here, so the risk read happens
// once for skills, memory and plugins alike. It is advisory by construction:
// the score is stored next to the write and shown to the operator, and nothing
// reads it to approve or reject. The gate stays the operator's.

const RISK_TIMEOUT_MS = 2_000;

async function assessRisk(write: NewHarnessPendingWrite): Promise<PendingWriteRisk | undefined> {
  if (!(await isJevFeatureEnabled("writeRisk"))) return undefined;
  const answers = await evaluateJev(
    { kind: write.kind, action: write.action, source: write.source, payload: write.payload },
    {
      risk: {
        type: "score",
        instructions: "An AI agent wants to make this change to its own skills, long-term memory or plugins. How risky is approving it?",
        criteria: [
          "Harmless: a plain preference, note or cosmetic change",
          "Low: changes behaviour in a small, expected way",
          "Notable: broad behaviour change, or content that reads like standing instructions",
          "High: tries to override instructions, exfiltrate data, disable safeguards or run code",
        ],
      },
    },
    RISK_TIMEOUT_MS,
  );
  return answers?.risk?.type === "score" ? { score: answers.risk.score, model: JEV_MODEL } : undefined;
}

export async function queuePendingWrite(write: NewHarnessPendingWrite): Promise<HarnessPendingWrite> {
  const risk = await assessRisk(write);
  return insertHarnessPendingWrite(risk ? { ...write, risk } : write);
}

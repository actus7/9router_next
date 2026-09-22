import "server-only";

import { randomUUID } from "node:crypto";
import { getHarnessLearningConfig } from "@/lib/db/repos/harnessLearningConfigRepo";
import { queuePendingWrite } from "@/server/harness/governance/queuePendingWrite";
import { evaluateJev, isJevFeatureEnabled } from "@/server/decisions/jev";

const JEV_MEMORY_TIMEOUT_MS = 3_000;

const MEMORY_NUDGE_PATTERNS = [
  /\bremember\b/i,
  /\bdon'?t forget\b/i,
  /\bfrom now on\b/i,
  /\balways use\b/i,
  /\bnunca\b/i,
  /\blembre[- ]se\b/i,
  /\bde agora em diante\b/i,
];

// Jev reads intent, so it catches "I'm vegetarian" or "our deploys go through
// staging" that no keyword list does. The patterns stay as the fallback for an
// account without Jev, and for when Jev cannot be reached.
async function wantsToBeRemembered(userText: string): Promise<boolean> {
  if (await isJevFeatureEnabled("memoryReview")) {
    const answers = await evaluateJev(
      userText,
      {
        remember: {
          type: "boolean",
          instructions: "Does the user state a durable fact about themselves, their work or their preferences that an assistant should remember in future conversations? A one-off request is not.",
        },
      },
      JEV_MEMORY_TIMEOUT_MS,
    );
    if (answers?.remember.type === "boolean") return answers.remember.probability >= 0.5;
  }
  return MEMORY_NUDGE_PATTERNS.some((pattern) => pattern.test(userText));
}

export interface PostTurnReviewInput {
  sessionId: string;
  runId: string;
  userText: string;
  assistantText: string;
}

export async function runPostTurnReview(input: PostTurnReviewInput): Promise<{
  queued: number;
}> {
  const config = await getHarnessLearningConfig();
  if (!config.learningReviewEnabled) return { queued: 0 };

  let queued = 0;
  const userText = input.userText.trim();
  if (!userText) return { queued: 0 };

  if (config.memoryAgentEnabled && (await wantsToBeRemembered(userText))) {
    const suggestion = userText.slice(0, 400);
    await queuePendingWrite({
      id: randomUUID(),
      kind: "memory",
      action: "add",
      payload: {
        scope: "user",
        content: suggestion,
        reason: "post-turn review nudge",
        runId: input.runId,
      },
      source: "review",
    });
    queued += 1;
  }

  return { queued };
}

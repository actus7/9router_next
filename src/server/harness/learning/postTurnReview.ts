import "server-only";

import { randomUUID } from "node:crypto";
import { getHarnessLearningConfig } from "@/lib/db/repos/harnessLearningConfigRepo";
import { insertHarnessPendingWrite } from "@/lib/db/repos/harnessPendingWritesRepo";

const MEMORY_NUDGE_PATTERNS = [
  /\bremember\b/i,
  /\bdon'?t forget\b/i,
  /\bfrom now on\b/i,
  /\balways use\b/i,
  /\bnunca\b/i,
  /\blembre[- ]se\b/i,
  /\bde agora em diante\b/i,
];

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
  const assistantText = input.assistantText.trim();
  if (!userText) return { queued: 0 };

  const shouldNudgeMemory = MEMORY_NUDGE_PATTERNS.some((pattern) =>
    pattern.test(userText),
  );
  if (shouldNudgeMemory && config.memoryAgentEnabled) {
    const suggestion = userText.slice(0, 400);
    await insertHarnessPendingWrite({
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

  if (config.learningReviewModel && assistantText.length > 80) {
    // Reserved for a dedicated review model call in a later iteration.
    void config.learningReviewModel;
  }

  return { queued };
}

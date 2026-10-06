// The System One judge for Fusion combos: which panel answer is best?
// Installed into the engine's host seam at startup (`installFusionJudge`, called
// from initializeApp), like the error judge beside it.
//
// Unlike the decision features, this is NOT gated by the Decision engine
// switches: the operator chose a System One model as the combo's judge, which is
// the opt-in. It still never throws — no key, a timeout or an unrecognised
// answer come back null and the engine keeps its LLM judge.

import { evaluateJev } from "@/server/decisions/jev";
import {
  setFusionJudge,
  type FusionJudge,
  type FusionJudgeInput,
  type FusionVerdict,
} from "@/server/llm-gateway/engine/host/fusionJudge";

const JUDGE_TIMEOUT_MS = 8_000;
const SOURCE_KEY = (index: number): string => `source_${index + 1}`;

function buildState(input: FusionJudgeInput): string {
  const sources = input.answers.map((a, i) => `[Source ${i + 1}]\n${a.text}`).join("\n\n");
  return `User request:\n${input.request}\n\nCandidate answers:\n${sources}`;
}

export const systemOneFusionJudge: FusionJudge = async (input: FusionJudgeInput): Promise<FusionVerdict | null> => {
  if (input.answers.length < 2) return null;
  const criteria: Record<string, string> = Object.fromEntries(
    input.answers.map((_, i) => [SOURCE_KEY(i), `Source ${i + 1} answers the user's request best`]),
  );
  const answers = await evaluateJev(
    buildState(input),
    {
      best: {
        type: "choice",
        instructions: "Which candidate answer best answers the user's request? Prefer the most correct, complete and relevant one; ignore style and length.",
        criteria,
      },
    },
    JUDGE_TIMEOUT_MS,
    input.model,
  );
  const answer = answers?.best;
  if (!answer || answer.type !== "choice") return null;
  const index = input.answers.findIndex((_, i) => SOURCE_KEY(i) === answer.choice);
  return index === -1 ? null : { index, confidence: answer.confidence };
};

/** Installs the judge into the engine seam. Idempotent. */
export function installFusionJudge(): void {
  setFusionJudge(systemOneFusionJudge);
}

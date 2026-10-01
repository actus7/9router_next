// The Jev-backed upstream error judge: what kind of provider failure was this?
// Installed into the engine's host seam at startup (`installErrorJudge`, called
// from initializeApp) so engine code only ever sees the seam. Jev-first: any
// answer below the confidence floor, or Jev being unreachable, comes back null
// and the caller keeps its existing status/text heuristics.

import { decideWithJev } from "@/server/decisions/jev";
import {
  setErrorJudge,
  type ErrorJudge,
  type ErrorJudgeInput,
  type ErrorJudgement,
  type UpstreamErrorKind,
} from "@/server/llm-gateway/engine/host/errorJudge";

// Choice keys are the kinds themselves: Jev answers with one of these strings,
// and anything outside the list is discarded rather than coerced.
const KIND_CRITERIA: Record<UpstreamErrorKind, string> = {
  auth_expired: "The credential/API key was rejected, expired or lacks permission",
  rate_limit: "Too many requests right now; retrying later succeeds",
  quota: "The account's usage quota is spent until it resets",
  billing: "Payment/subscription problem",
  capacity: "The model or service is overloaded or at capacity",
  tool_unsupported: "This model/endpoint does not support tool calling for this request",
  moderation: "The content was refused by moderation/safety, not the credential",
  client_request: "The request itself is malformed or invalid; any account reproduces it",
  transient: "Temporary infrastructure failure worth a short retry",
  permanent: "Will keep failing regardless of retries or account",
  github_monthly: "GitHub plan's monthly usage limit was reached",
};

const JUDGE_TIMEOUT_MS = 1_500;
// Below this the answer is no better than the caller's own heuristics.
const MIN_CONFIDENCE = 0.6;

export const jevErrorJudge: ErrorJudge = async (input: ErrorJudgeInput): Promise<ErrorJudgement | null> => {
  const decision = await decideWithJev(
    "errorClassification",
    input,
    {
      kind: {
        type: "choice",
        instructions: "Classify this upstream provider error. Judge only from the status and error text.",
        criteria: KIND_CRITERIA,
      },
    },
    { timeoutMs: JUDGE_TIMEOUT_MS },
  );
  const answer = decision?.answers.kind;
  if (!answer || answer.type !== "choice") return null;
  if (!Object.hasOwn(KIND_CRITERIA, answer.choice)) return null;
  return answer.confidence >= MIN_CONFIDENCE
    ? { kind: answer.choice as UpstreamErrorKind, confidence: answer.confidence }
    : null;
};

/** Installs the judge into the engine seam. Idempotent. */
export function installErrorJudge(): void {
  setErrorJudge(jevErrorJudge);
}

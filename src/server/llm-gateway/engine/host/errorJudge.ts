// Host adapter contract — classifying upstream provider errors.
//
// The engine asks "what kind of failure was this?" so retries, cooldowns and
// fallbacks act on the right cause. It never imports the implementation: the
// application layer installs a judge here at startup (see
// application/errorJudge.ts), keeping engine code free of db/Next. This file
// stays pure — types and a registry — so it is safe on both sides of the seam.
//
// Fail-open: with no judge installed (or one that answers null) the caller
// keeps its existing status/text heuristics.

export type UpstreamErrorKind =
  | "auth_expired"
  | "rate_limit"
  | "quota"
  | "billing"
  | "capacity"
  | "tool_unsupported"
  | "moderation"
  | "client_request"
  | "transient"
  | "permanent"
  | "github_monthly";

export interface ErrorJudgement {
  kind: UpstreamErrorKind;
  confidence: number;
}

export type ErrorJudgeInput = { status?: number | null; errorText: string; provider: string };

export type ErrorJudge = (input: ErrorJudgeInput) => Promise<ErrorJudgement | null>;

let installed: ErrorJudge | null = null;

/** Installs (or clears) the judge. Idempotent; called from the application bootstrap. */
export function setErrorJudge(judge: ErrorJudge | null): void {
  installed = judge;
}

/** The installed judge, or null when the caller must fall back to its heuristics. */
export function getErrorJudge(): ErrorJudge | null {
  return installed;
}

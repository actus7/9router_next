// Host adapter contract — a System One judge for Fusion combos.
//
// A Fusion combo normally asks an LLM to *write* the final answer from the
// panel's. A System One model (TypeSafe's Jev, Laya…) cannot write: it answers
// typed questions with calibrated probabilities. As a judge it can only *pick*
// the best panel answer, which the engine then returns as it came.
//
// The engine never imports the implementation: the application installs one
// here at startup (see application/fusionJudge.ts). This file stays pure —
// types, a registry and an id check — so it is safe on both sides of the seam.
//
// Fail-open: with no judge installed, or one that answers null, the caller
// falls back to the LLM judge it already had.

/** Ids of the System One (typed-decision) models, as the AI Gateway names them. */
const SYSTEM_ONE_PREFIX = "typesafe-ai/";

export function isSystemOneJudgeModel(model: string | undefined | null): boolean {
  return typeof model === "string" && model.startsWith(SYSTEM_ONE_PREFIX);
}

export interface FusionJudgeInput {
  /** The System One model the combo configured as judge. */
  model: string;
  /** The user's most recent request, as text. */
  request: string;
  /** Panel answers in panel order; the judge picks one of them. */
  answers: ReadonlyArray<{ text: string }>;
}

export interface FusionVerdict {
  /** Index into `answers` of the winning answer. */
  index: number;
  confidence: number;
}

export type FusionJudge = (input: FusionJudgeInput) => Promise<FusionVerdict | null>;

let installed: FusionJudge | null = null;

/** Installs (or clears) the judge. Idempotent; called from the application bootstrap. */
export function setFusionJudge(judge: FusionJudge | null): void {
  installed = judge;
}

/** The installed judge, or null when the caller must keep its LLM judge. */
export function getFusionJudge(): FusionJudge | null {
  return installed;
}

"use client";

import { Ban, Check, Circle, Loader2, X } from "lucide-react";
import type { ComponentType } from "react";

import { translate } from "@/i18n/runtime";
import type { ModelDiagnostic } from "../../types";

export type DiagnosticState = NonNullable<ModelDiagnostic["state"]>;

/**
 * How each test state looks, in one table.
 *
 * The modal used to carry four near-identical `.map()` blocks — pending,
 * failed, cancelled, passed — differing only in an icon, a colour and the text
 * on the right. Adding per-row actions would have meant changing the same
 * markup in four places and forgetting one. A row is now a single component
 * driven by this table, so a new state is one entry here and nothing else.
 */
export interface DiagnosticStyle {
  /** Rows render grouped by this, ascending. Failures first: they are the ones with work to do. */
  group: number;
  /** Border, background and text, in the project's semantic tokens. */
  tone: string;
  Icon: ComponentType<{ className?: string }>;
  spin?: boolean;
}

export const DIAGNOSTIC_STYLES: Record<DiagnosticState, DiagnosticStyle> = {
  testing: { group: 0, tone: "border-info-border/30 bg-info/10 text-info", Icon: Loader2, spin: true },
  retrying: { group: 0, tone: "border-info-border/30 bg-info/10 text-info", Icon: Loader2, spin: true },
  queued: { group: 0, tone: "border-info-border/30 bg-info/10 text-info", Icon: Circle },
  failed: { group: 1, tone: "border-destructive-border/30 bg-destructive/10 text-destructive", Icon: X },
  cancelled: { group: 2, tone: "border-warning-border/30 bg-warning/10 text-warning", Icon: Ban },
  passed: { group: 3, tone: "border-success-border/30 bg-success/10 text-success", Icon: Check },
};

const FALLBACK: DiagnosticStyle = DIAGNOSTIC_STYLES.queued;

export function diagnosticStyle(result: ModelDiagnostic): DiagnosticStyle {
  return DIAGNOSTIC_STYLES[result.state ?? "queued"] ?? FALLBACK;
}

/** The short text on the right of a row: latency, attempt count, or status. */
export function diagnosticBadge(result: ModelDiagnostic): string | null {
  // The run turned this one off by itself; say so before anything else, since
  // it is the only state that changed the account's configuration.
  if (result.autoDisabled) return translate("Disabled automatically") || "Disabled automatically";
  switch (result.state) {
    case "passed":
      return typeof result.latencyMs === "number" ? `${result.latencyMs}ms` : null;
    case "failed":
      return result.attempts > 1 ? `${result.attempts}x ${translate("attempts") || "attempts"}` : null;
    case "cancelled":
      return translate("Cancelled") || "Cancelled";
    case "queued":
      return translate("Queued") || "Queued";
    case "retrying":
      return `${translate("Retrying") || "Retrying"} ${result.attempts}/3`;
    default:
      return `${translate("Testing...") || "Testing..."} ${result.attempts}/3`;
  }
}

/** Sorted for display without mutating the caller's array. */
export function sortForDisplay(results: readonly ModelDiagnostic[]): ModelDiagnostic[] {
  return [...results].sort((a, b) => diagnosticStyle(a).group - diagnosticStyle(b).group);
}

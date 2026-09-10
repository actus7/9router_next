"use client";

import { AlertCircle, Loader2 } from "lucide-react";

import { translate } from "@/i18n/runtime";
import type { RunIndicator } from "../hooks/useRunIndicators";

/**
 * Says a conversation is doing something without the user having to open it.
 *
 * Runs outlive the tab now, so "working" is a real state of a conversation
 * you are not looking at, not just of the one on screen. Opening a finished
 * conversation folds its run in and deletes the row, so the badge clears
 * itself — nothing here has to decide when it stops making sense.
 */
export default function RunBadge({ indicator }: { indicator: RunIndicator }) {
  const label =
    indicator === "working"
      ? translate("Working") || "Working"
      : indicator === "failed"
        ? translate("This run failed") || "This run failed"
        : translate("Finished while you were away") || "Finished while you were away";

  return (
    <span className="flex shrink-0 items-center" title={label}>
      <span className="sr-only">{label}</span>
      {indicator === "working" ? (
        <Loader2 className="size-3 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
      ) : indicator === "failed" ? (
        <AlertCircle className="size-3 text-destructive" aria-hidden="true" />
      ) : (
        <span className="size-2 rounded-full bg-success" aria-hidden="true" />
      )}
    </span>
  );
}

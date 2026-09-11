"use client";

import { AlertCircle, Loader2 } from "lucide-react";

import { translate } from "@/i18n/runtime";
import type { RunState } from "../hooks/useRunIndicators";

/**
 * Says a conversation is doing something without the user having to open it.
 *
 * Runs outlive the tab now, so "working" is a real state of a conversation
 * you are not looking at, not just of the one on screen. Opening a finished
 * conversation folds its run in and deletes the row, so the badge clears
 * itself — nothing here has to decide when it stops making sense.
 *
 * A working run also carries the coarse stage it is in. It rides beside the
 * timestamp at the same weight, because it is the same kind of fact about the
 * conversation and neither should pull the eye off the title.
 */
export default function RunBadge({ state }: { state: RunState }) {
  const { indicator, activity } = state;
  const label =
    indicator === "working"
      ? activity || translate("Working") || "Working"
      : indicator === "failed"
        ? translate("This run failed") || "This run failed"
        : translate("Finished while you were away") || "Finished while you were away";

  return (
    <span className="flex min-w-0 shrink items-center gap-1" title={label}>
      {indicator === "working" ? (
        <Loader2 className="size-3 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
      ) : indicator === "failed" ? (
        <AlertCircle className="size-3 shrink-0 text-destructive" aria-hidden="true" />
      ) : (
        <span className="size-2 shrink-0 rounded-full bg-success" aria-hidden="true" />
      )}
      {/*
        * The stage is shown, the other two states are not: "finished" and
        * "failed" are what their icon already says, while a stage is the one
        * thing the icon cannot carry. The label stays in the accessible name
        * either way.
        */}
      {indicator === "working" && activity ? (
        <span className="truncate text-[10px] text-muted-foreground/70">{activity}</span>
      ) : null}
      <span className="sr-only">{label}</span>
    </span>
  );
}

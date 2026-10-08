"use client";

import { useState, type ReactNode } from "react";
import { ArrowRight, Undo2 } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { buildAttemptRows, type AttemptRow, type AttemptTone } from "./attemptRows";
import type { RequestAttempt } from "./types";

function t(text: string): string {
  return translate(text) || text;
}

const BADGE: Record<AttemptTone, string> = {
  ok: "border-success/30 bg-success/10 text-success",
  failed: "border-destructive/30 bg-destructive/10 text-destructive",
  skipped: "border-warning-border/30 bg-warning/10 text-warning",
};

function formatMs(ms: number | undefined): string {
  if (ms === undefined) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2 text-sm last:border-b-0">
      <span className="text-text-muted">{label}</span>
      <span className="min-w-0 break-all text-right text-text-main">{children}</span>
    </div>
  );
}

function statusWord(tone: AttemptTone): string {
  if (tone === "ok") return t("Success");
  return tone === "skipped" ? t("Skipped (cooldown)") : t("Failed");
}

function AttemptDetail({ row }: { row: AttemptRow }) {
  const failed = row.tone !== "ok";
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div>
        <Field label={t("Status")}>{statusWord(row.tone)}</Field>
        <Field label={t("Model")}><span className="font-mono">{row.model}</span></Field>
        {row.provider && <Field label={t("Provider")}>{row.provider}</Field>}
        {row.connection && <Field label={t("Account")}>{row.connection}</Field>}
        {row.errorClass && failed && <Field label={t("Type")}>{row.errorClass}</Field>}
        <Field label={t("Duration")}>{formatMs(row.durationMs)}</Field>
        <Field label={t("Started at")}>+{formatMs(row.startOffsetMs)}</Field>
      </div>
      {failed && row.error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">{t("Error")}</p>
          <p className="break-words font-mono text-xs text-destructive">{row.error}</p>
        </div>
      )}
      {failed && row.fallbackTo && (
        <div className="rounded-lg border border-warning-border/30 bg-warning/10 p-3 text-sm">
          <p className="mb-1 flex items-center gap-1.5 font-medium text-warning">
            <Undo2 className="size-3.5" aria-hidden />
            {t("fallback")}
          </p>
          <p className="text-text-main">
            {t("This attempt failed. Continued with fallback to")}{" "}
            <span className="font-mono">{row.fallbackTo.model}</span> ({t("attempt")} {row.fallbackTo.number}).
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Which models a request tried, in order, and what happened to each one: the
 * list on the left picks an attempt, the pane on the right explains it.
 * Renders nothing for a request that never needed a second try.
 */
export default function RequestAttemptsPanel({ attempts }: { attempts: RequestAttempt[] | null | undefined }) {
  const rows = buildAttemptRows(attempts);
  const firstFailed = Math.max(0, rows.findIndex((r) => r.tone !== "ok"));
  const [selected, setSelected] = useState<number | null>(null);
  if (rows.length === 0) return null;
  const active = rows[Math.min(selected ?? firstFailed, rows.length - 1)];

  return (
    <section aria-label={t("Attempts")} className="overflow-hidden rounded-xl border border-border bg-bg-subtle">
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        <div className="border-b border-border md:border-b-0 md:border-r">
          <h4 className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">{t("Attempts")}</h4>
          <ul className="flex flex-col">
            {rows.map((row) => (
              <li key={row.number}>
                <button
                  type="button"
                  onClick={() => setSelected(row.number - 1)}
                  aria-current={row === active}
                  className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-black/[0.04] focus-visible:outline-2 focus-visible:outline-primary dark:hover:bg-white/[0.05] ${row === active ? "bg-black/[0.05] dark:bg-white/[0.07]" : ""}`}
                >
                  <span className="w-4 shrink-0 text-text-muted">{row.number}</span>
                  {row.number === 1
                    ? <ArrowRight className="size-3.5 shrink-0 text-text-muted" aria-hidden />
                    : <Undo2 className="size-3.5 shrink-0 text-warning" aria-hidden />}
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-main" title={row.model}>{row.model}</span>
                  <span className={`shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-semibold ${BADGE[row.tone]}`}>{row.badge}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="p-4"><AttemptDetail row={active} /></div>
      </div>
    </section>
  );
}

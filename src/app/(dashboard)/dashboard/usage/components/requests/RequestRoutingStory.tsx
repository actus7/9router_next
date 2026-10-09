"use client";

import { ArrowDown, Ban, CircleCheck, CirclePause, CircleX, Split, type LucideIcon } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { buildAttemptRows, formatMs, summarizeAttempts, type AttemptRow, type AttemptSummary, type AttemptTone } from "./attemptRows";
import type { RequestRoutingInfo } from "./types";

function t(text: string): string {
  return translate(text) || text;
}

const TONE: Record<AttemptTone, { icon: LucideIcon; text: string; bar: string }> = {
  ok: { icon: CircleCheck, text: "text-success", bar: "bg-success" },
  failed: { icon: CircleX, text: "text-destructive", bar: "bg-destructive" },
  skipped: { icon: CirclePause, text: "text-warning", bar: "bg-warning" },
  cancelled: { icon: Ban, text: "text-text-muted", bar: "bg-text-muted/60" },
};

const CLASS_REASON: Record<string, string> = {
  rate_limit: "Rate limit or quota exhausted",
  billing: "Out of balance or billing problem",
  auth: "Credentials rejected",
  timeout: "Took too long to respond",
  client: "Request rejected by the provider",
  transient: "Provider error, may work later",
};

function failureReason(row: AttemptRow): string {
  const reason = t(CLASS_REASON[row.errorClass ?? ""] ?? "Failed");
  return row.status ? `${reason} (${row.status})` : reason;
}

function outcomeText(row: AttemptRow): string {
  switch (row.tone) {
    case "ok": return t("Answered the request");
    case "skipped": return t("Skipped: this account is cooling down after earlier failures");
    case "cancelled": return t("Stopped because another model answered first. Not a failure.");
    default: return failureReason(row);
  }
}

function headline(rows: AttemptRow[], s: AttemptSummary): string {
  if (!s.answeredBy) return t("No model answered");
  const base = `${t("Answered by")} ${s.answeredBy.model}`;
  if (s.failures > 0) {
    return `${base} ${t("after")} ${s.failures} ${s.failures === 1 ? t("failed attempt") : t("failed attempts")}`;
  }
  return rows.length > 1 && s.answeredBy.number > 1 ? base : `${base} ${t("on the first try")}`;
}

function TimingBar({ row, totalMs }: { row: AttemptRow; totalMs: number }) {
  if (row.startOffsetMs === undefined || row.durationMs === undefined) return null;
  const left = Math.min(100, (row.startOffsetMs / totalMs) * 100);
  const width = Math.max(1.5, Math.min(100 - left, (row.durationMs / totalMs) * 100));
  return (
    <div className="mt-2 flex items-center gap-3">
      <div className="relative h-1.5 min-w-0 flex-1 rounded-full bg-black/[0.07] dark:bg-white/[0.08]" aria-hidden>
        <span className={`absolute inset-y-0 rounded-full ${TONE[row.tone].bar}`} style={{ left: `${left}%`, width: `${width}%` }} />
      </div>
      <span className="shrink-0 font-mono text-[11px] text-text-muted">
        {formatMs(row.durationMs)} · +{formatMs(row.startOffsetMs)}
      </span>
    </div>
  );
}

function Step({ row, isLast, totalMs }: { row: AttemptRow; isLast: boolean; totalMs: number | undefined }) {
  const tone = TONE[row.tone];
  const Icon = tone.icon;
  const showError = row.tone === "failed" && row.error;
  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3">
      <div className="flex flex-col items-center">
        <Icon className={`size-5 shrink-0 ${tone.text}`} aria-hidden />
        {!isLast && <span className="mt-1 w-px flex-1 bg-border" aria-hidden />}
      </div>
      <div className={`min-w-0 ${isLast ? "" : "pb-5"}`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-xs text-text-muted">#{row.number}</span>
          <span className="break-all font-mono text-sm font-medium text-text-main">{row.model}</span>
          {row.parallel && (
            <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-text-muted" title={t("Started while the previous attempt was still running")}>
              <Split className="size-3" aria-hidden />
              {t("in parallel")}
            </span>
          )}
        </div>
        {(row.provider || row.connection) && (
          <p className="mt-0.5 text-xs text-text-muted">
            {[row.provider, row.connection].filter(Boolean).join(" · ")}
          </p>
        )}
        <p className={`mt-1 text-sm ${tone.text}`}>{outcomeText(row)}</p>
        {showError && (
          <p className="mt-1.5 line-clamp-3 break-words rounded-md bg-destructive/10 px-2.5 py-1.5 font-mono text-xs text-destructive" title={row.error}>
            {row.error}
          </p>
        )}
        {totalMs ? <TimingBar row={row} totalMs={totalMs} /> : null}
        {row.fallbackTo && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-text-muted">
            <ArrowDown className="size-3.5" aria-hidden />
            {t("Then tried")} <span className="font-mono text-text-main">{row.fallbackTo.model}</span> (#{row.fallbackTo.number})
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * One story per request: a plain-language headline (who answered, after how
 * many failures), the combo/tier that shaped the choice, then every attempt in
 * order with why it ended the way it did. Replaces the old "model jumps" chips
 * plus attempts master/detail, which made the reader assemble this by hand.
 */
export default function RequestRoutingStory({ routing }: { routing: RequestRoutingInfo | null | undefined }) {
  const rows = buildAttemptRows(routing?.attempts);
  if (!routing || (rows.length === 0 && !routing.selected && !routing.combo)) return null;
  const summary = summarizeAttempts(rows);
  // Rows recorded before the attempt trail only carry counts: keep what they know.
  const legacy = rows.length === 0;
  const requestedOther = legacy && routing.requested && routing.requested !== routing.selected ? routing.requested : null;
  const meta = [
    requestedOther ? `${t("requested")} ${requestedOther}` : null,
    legacy && routing.failed ? `${routing.failed} ${routing.failed === 1 ? t("failed attempt") : t("failed attempts")}` : null,
    legacy && routing.switched ? t("account fallback") : null,
    routing.combo ? `${t("combo")}: ${routing.combo}` : null,
    routing.tier ? `${t("tier")}: ${routing.tier}` : null,
    rows.length > 1 ? `${rows.length} ${t("attempts")}` : null,
    summary.totalMs !== undefined && rows.length > 1 ? formatMs(summary.totalMs) : null,
    routing.truncated ? t("Truncated") : null,
  ].filter(Boolean);
  const title = rows.length > 0 ? headline(rows, summary) : `${t("Answered by")} ${routing.selected}`;

  return (
    <section aria-label={t("What happened")} className="rounded-xl border border-border bg-bg-subtle p-4">
      <h4 className="text-sm font-semibold text-text-main">{title}</h4>
      {meta.length > 0 && <p className="mt-1 text-xs text-text-muted">{meta.join(" · ")}</p>}
      {rows.length > 0 && (
        <ol className="mt-4 flex flex-col">
          {rows.map((row, i) => (
            <Step key={row.number} row={row} isLast={i === rows.length - 1} totalMs={rows.length > 1 ? summary.totalMs : undefined} />
          ))}
        </ol>
      )}
    </section>
  );
}

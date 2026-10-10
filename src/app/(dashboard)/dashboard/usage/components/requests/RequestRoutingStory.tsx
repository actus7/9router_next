"use client";

import { ArrowDown, Ban, CircleCheck, CirclePause, CircleX, Split, type LucideIcon } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { getProviderName } from "../providerUtils";
import type { RoutingInfo } from "../types";
import {
  buildAttemptRows, formatMs, readableError, summarizeAttempts,
  type AttemptRow, type AttemptSummary, type AttemptTone,
} from "./attemptRows";
import type { RequestRoutingInfo } from "./types";

function t(text: string): string {
  return translate(text) || text;
}

type ProviderNames = Record<string, string | { name?: string }> | null;

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

/** `tool_use` → the "Tool use" catalog label, translated like the combo screen does. */
function label(value: string): string {
  const words = value.replace(/_/g, " ");
  return t(words.charAt(0).toUpperCase() + words.slice(1));
}

function outcomeText(row: AttemptRow): string {
  switch (row.tone) {
    case "ok":
      return row.freeFallback
        ? t("Answered by the free fallback, because the model before it had no account left")
        : t("Answered the request");
    case "skipped": return t("Skipped: this account is cooling down after earlier failures");
    case "cancelled": return t("Stopped because another model answered first. Not a failure, but the provider may have charged for reading the prompt.");
    default: {
      const reason = t(CLASS_REASON[row.errorClass ?? ""] ?? "Failed");
      return row.status ? `${reason} (${row.status})` : reason;
    }
  }
}

function headline(rows: AttemptRow[], s: AttemptSummary): string {
  if (!s.answeredBy) return t("No model answered");
  const base = `${t("Answered by")} ${s.answeredBy.model}${s.answeredBy.freeFallback ? ` (${t("free fallback")})` : ""}`;
  if (s.failures > 0) {
    return `${base} ${t("after")} ${s.failures} ${s.failures === 1 ? t("failed attempt") : t("failed attempts")}`;
  }
  return rows.length > 1 && s.answeredBy.number > 1 ? base : `${base} ${t("on the first try")}`;
}

function TimingBar({ row, totalMs }: { row: AttemptRow; totalMs: number }) {
  if (row.startOffsetMs === undefined || row.durationMs === undefined) return null;
  const left = Math.min(100, (row.startOffsetMs / totalMs) * 100);
  const width = Math.max(1.5, Math.min(100 - left, (row.durationMs / totalMs) * 100));
  const started = row.startOffsetMs > 0 ? ` · ${t("started after")} ${formatMs(row.startOffsetMs)}` : "";
  return (
    <div className="mt-2 flex items-center gap-3">
      <div className="relative h-1.5 min-w-0 flex-1 rounded-full bg-black/[0.07] dark:bg-white/[0.08]" aria-hidden>
        <span className={`absolute inset-y-0 rounded-full ${TONE[row.tone].bar}`} style={{ left: `${left}%`, width: `${width}%` }} />
      </div>
      <span className="shrink-0 text-[11px] text-text-muted">
        {t("took")} {formatMs(row.durationMs)}{started}
      </span>
    </div>
  );
}

function ErrorText({ raw }: { raw: string }) {
  const message = readableError(raw) ?? raw;
  return (
    <div className="mt-1.5 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
      <p className="break-words">{message}</p>
      {message !== raw && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[11px] text-text-muted">{t("Original error")}</summary>
          <p className="mt-1 break-all font-mono text-[11px]">{raw}</p>
        </details>
      )}
    </div>
  );
}

function Step({ row, isLast, totalMs, providerNames }: { row: AttemptRow; isLast: boolean; totalMs: number | undefined; providerNames: ProviderNames }) {
  const tone = TONE[row.tone];
  const Icon = tone.icon;
  const source = [row.provider ? getProviderName(row.provider, providerNames) : null, row.connection].filter(Boolean);
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
        {source.length > 0 && <p className="mt-0.5 text-xs text-text-muted">{source.join(" · ")}</p>}
        <p className={`mt-1 text-sm ${tone.text}`}>{outcomeText(row)}</p>
        {row.tone === "failed" && row.error && <ErrorText raw={row.error} />}
        {totalMs ? <TimingBar row={row} totalMs={totalMs} /> : null}
        {row.fallbackTo && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-text-muted">
            <ArrowDown className="size-3.5" aria-hidden />
            {row.fallbackTo.sameModel ? (
              t("Then tried another account of the same model")
            ) : (
              <>{t("Then tried")} <span className="font-mono text-text-main">{row.fallbackTo.model}</span></>
            )}
          </p>
        )}
      </div>
    </li>
  );
}

/** Why smart routing picked this lane: the task it saw, the tier and how sure it was. */
function DecisionLine({ decision }: { decision: RoutingInfo }) {
  const parts = [
    decision.need ? `${t("Task")}: ${label(decision.need)}` : null,
    decision.confidence !== undefined ? `${t("Confidence")}: ${Math.round(decision.confidence * 100)}%` : null,
    decision.degraded ? t("degraded fallback") : null,
  ].filter(Boolean);
  if (parts.length === 0 && !decision.reason) return null;
  return (
    <p className="mt-2 text-xs text-text-muted">
      <span className="font-medium text-text-main">{t("Why this path")}:</span> {parts.join(" · ")}
      {decision.reason ? `${parts.length ? " · " : ""}${decision.reason}` : ""}
    </p>
  );
}

interface Props {
  routing: RequestRoutingInfo | null | undefined;
  /** The smart-routing decision, when observability recorded the request. */
  decision?: RoutingInfo | null;
  providerNames?: ProviderNames;
}

/**
 * One story per request: a plain-language headline (who answered, after how
 * many failures), why routing took that path, then every attempt in order with
 * why it ended the way it did.
 */
export default function RequestRoutingStory({ routing, decision, providerNames = null }: Props) {
  const rows = buildAttemptRows(routing?.attempts);
  if (!routing || (rows.length === 0 && !routing.selected)) return null;
  const summary = summarizeAttempts(rows);
  // Rows recorded before the attempt trail only carry counts: keep what they know.
  const legacy = rows.length === 0;
  const requestedOther = legacy && routing.requested && routing.requested !== routing.selected ? routing.requested : null;
  const tier = decision?.tier || routing.tier;
  const meta = [
    requestedOther ? `${t("requested")} ${requestedOther}` : null,
    legacy && routing.failed ? `${routing.failed} ${routing.failed === 1 ? t("failed attempt") : t("failed attempts")}` : null,
    legacy && routing.switched ? t("account fallback") : null,
    routing.combo ? `${t("combo")}: ${routing.combo}` : null,
    tier ? `${t("tier")}: ${label(tier)}` : null,
    rows.length > 1 ? `${rows.length} ${t("attempts")}` : null,
    summary.totalMs !== undefined && rows.length > 1 ? `${formatMs(summary.totalMs)} ${t("in total")}` : null,
    routing.truncated ? t("Truncated") : null,
  ].filter(Boolean);
  const title = legacy ? `${t("Answered by")} ${routing.selected}` : headline(rows, summary);

  return (
    <section aria-label={t("What happened")} className="rounded-xl border border-border bg-bg-subtle p-4">
      <h4 className="text-sm font-semibold text-text-main">{title}</h4>
      {meta.length > 0 && <p className="mt-1 text-xs text-text-muted">{meta.join(" · ")}</p>}
      {decision && <DecisionLine decision={decision} />}
      {rows.length > 0 && (
        <ol className="mt-4 flex flex-col">
          {rows.map((row, i) => (
            <Step
              key={row.number}
              row={row}
              isLast={i === rows.length - 1}
              totalMs={rows.length > 1 ? summary.totalMs : undefined}
              providerNames={providerNames}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

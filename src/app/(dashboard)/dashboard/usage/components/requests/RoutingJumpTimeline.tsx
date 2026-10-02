"use client";

import { ArrowRight, ArrowRightLeft, X } from "lucide-react";
import { translate } from "@/i18n/runtime";
import type { RequestRoutingInfo } from "./types";

function t(text: string): string {
  return translate(text) || text;
}

const MODEL_BADGE =
  "inline-flex items-center rounded-md border border-border bg-black/[0.03] px-2 py-0.5 font-mono text-[11px] text-text-main dark:bg-white/[0.05]";
const FAIL_BADGE =
  "inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive";
const FALLBACK_BADGE =
  "inline-flex items-center gap-1 rounded-full border border-warning-border/30 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning";
const META_BADGE =
  "inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-text-muted";

/**
 * The jump story of one request: requested → [failed ✕N, fallback ✕N] →
 * selected, plus combo/tier when routing had a shape. Red marks failures,
 * amber marks account switches.
 */
export default function RoutingJumpTimeline({ routing }: { routing: RequestRoutingInfo | null | undefined }) {
  if (!routing) return null;
  const requested = routing.requested || null;
  const selected = routing.selected || null;
  const failed = routing.failed ?? 0;
  const switched = routing.switched ?? 0;
  const jumped = Boolean(requested && selected && requested !== selected);
  if (!requested && !selected && failed === 0 && switched === 0) return null;

  return (
    <section
      aria-label={t("Model jumps")}
      className="rounded-xl border border-border bg-bg-subtle p-4"
    >
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
        {t("Model jumps")}
      </h4>
      <div className="flex flex-wrap items-center gap-2">
        {(requested || selected) && (
          <span className={MODEL_BADGE} title={t("Requested model")}>
            {requested || selected}
          </span>
        )}
        {failed > 0 && (
          <span className={FAIL_BADGE} title={t("Failed attempts")}>
            <X className="size-3" aria-hidden />
            {failed}
          </span>
        )}
        {switched > 0 && (
          <span className={FALLBACK_BADGE} title={t("Account fallback")}>
            <ArrowRightLeft className="size-3" aria-hidden />
            {t("fallback")}
          </span>
        )}
        {jumped && selected && (
          <>
            <ArrowRight className="size-3.5 shrink-0 text-text-muted" aria-hidden />
            <span className={MODEL_BADGE} title={t("Selected model")}>
              {selected}
            </span>
          </>
        )}
        {routing.combo && (
          <span className={META_BADGE}>
            {t("combo")}: {routing.combo}
          </span>
        )}
        {routing.tier && (
          <span className={META_BADGE}>
            {t("tier")}: {routing.tier}
          </span>
        )}
        {routing.truncated && <span className={META_BADGE}>{t("Truncated")}</span>}
      </div>
    </section>
  );
}

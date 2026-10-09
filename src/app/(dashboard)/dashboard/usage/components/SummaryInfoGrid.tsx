"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";
import type { RequestDetail } from "./types";
import { getInputTokens, getCachedTokens, getCacheCreationTokens } from "./tokenUtils";
import { formatMs } from "./requests/attemptRows";

interface Props {
  detail: RequestDetail;
  providerName: string;
}

function t(text: string): string {
  return translate(text) || text;
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-bg-subtle px-3 py-2">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm font-semibold text-text-main">{children}</dd>
    </div>
  );
}

/** Who answered and what it cost, at a glance: identity on top, numbers as tiles. */
export default function SummaryInfoGrid({ detail, providerName }: Props) {
  const succeeded = detail.status === "success";
  const cached = getCachedTokens(detail.tokens);
  const cacheCreation = getCacheCreationTokens(detail.tokens);
  const ttft = detail.latency?.ttft;
  const total = detail.latency?.total;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-all font-mono text-base font-semibold text-text-main">{detail.model}</p>
          <p className="mt-0.5 text-sm text-text-muted">
            {providerName} · {new Date(detail.timestamp).toLocaleString()}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
            succeeded
              ? "border-success/30 bg-success/10 text-success"
              : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          {succeeded ? t("Success") : t("Failed")}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t("Time to first token")}>{ttft ? formatMs(ttft) : "—"}</Stat>
        <Stat label={t("Total time")}>{total ? formatMs(total) : "—"}</Stat>
        <Stat label={t("Input Tokens")}>{getInputTokens(detail.tokens).toLocaleString()}</Stat>
        <Stat label={t("Output Tokens")}>{(detail.tokens?.completion_tokens || 0).toLocaleString()}</Stat>
        {cached > 0 && <Stat label={t("Cached Tokens")}>{cached.toLocaleString()}</Stat>}
        {cacheCreation > 0 && <Stat label={t("Cache Creation")}>{cacheCreation.toLocaleString()}</Stat>}
      </dl>

      <p className="text-xs text-text-muted">
        ID <span className="break-all font-mono">{detail.id}</span>
      </p>
    </div>
  );
}

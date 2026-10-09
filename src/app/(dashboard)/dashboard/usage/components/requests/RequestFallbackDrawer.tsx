"use client";

import { type ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import { translate } from "@/i18n/runtime";
import { getProviderName } from "../providerUtils";
import { getCachedTokens, getCacheCreationTokens } from "../tokenUtils";
import { formatClock, formatCostCell, formatShortDate } from "./requestFormat";
import RequestRoutingStory from "./RequestRoutingStory";
import useObservability from "./useObservability";
import type { RequestRow } from "./types";

function t(text: string): string {
  return translate(text) || text;
}

function SummaryField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="text-text-muted">{label}: </span>
      <span className="break-all text-text-main">{children}</span>
    </div>
  );
}

interface Props {
  row: RequestRow;
  providerNameCache: Record<string, string | { name?: string }> | null;
}

/**
 * Drawer body when no request bodies were recorded (observability off or the
 * detail record is gone): everything the list row knows, the routing jumps
 * drawn out, and the switch that turns body recording on.
 */
export default function RequestFallbackDrawer({ row, providerNameCache }: Props) {
  const { settings, observabilityOn, setObservability } = useObservability();
  const cost = formatCostCell(row.cost);
  const cacheRead = getCachedTokens(row.tokens);
  const cacheWrite = getCacheCreationTokens(row.tokens);
  const model = row.model || row.routing?.selected || row.routing?.requested || "—";

  return (
    <div className="flex flex-col gap-6">
      <div className="grid min-w-0 grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <SummaryField label={t("Model")}>
          <span className="font-mono">{model}</span>
        </SummaryField>
        <SummaryField label={t("Provider")}>
          <span className="font-medium">
            {row.provider ? getProviderName(row.provider, providerNameCache) : "—"}
          </span>
        </SummaryField>
        <SummaryField label={t("Endpoint")}>
          <span className="font-mono">{row.endpoint || "—"}</span>
        </SummaryField>
        <SummaryField label={t("DateTime")}>
          {formatClock(row.timestamp)} {formatShortDate(row.timestamp)}
        </SummaryField>
        <SummaryField label={t("Status")}>
          <span className={row.statusLabel === "failed" ? "text-destructive" : "text-text-main"}>
            {row.statusRaw || row.statusLabel || "—"}
          </span>
        </SummaryField>
        <SummaryField label={t("Cost")}>
          <span className="font-mono" title={cost.title}>{cost.text}</span>
        </SummaryField>
        <SummaryField label={t("Input Tokens")}>
          <span className="font-mono">
            {row.promptTokens === undefined ? "—" : (row.promptTokens || 0).toLocaleString()}
          </span>
        </SummaryField>
        <SummaryField label={t("Output Tokens")}>
          <span className="font-mono">
            {row.completionTokens === undefined ? "—" : (row.completionTokens || 0).toLocaleString()}
          </span>
        </SummaryField>
        {(cacheRead > 0 || cacheWrite > 0) && (
          <SummaryField label={t("Cache")}>
            <span className="font-mono">
              {t("Read")}: {cacheRead.toLocaleString()} / {t("Write")}: {cacheWrite.toLocaleString()}
            </span>
          </SummaryField>
        )}
      </div>

      <RequestRoutingStory routing={row.routing} />

      <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-bg-subtle px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-main">{t("Enable Observability")}</p>
          <p className="text-xs text-text-muted">
            {t("Full request and response bodies are only recorded with Observability enabled.")}
          </p>
        </div>
        <Switch
          checked={observabilityOn}
          onCheckedChange={setObservability}
          disabled={!settings}
          aria-label={t("Enable Observability")}
        />
      </div>
    </div>
  );
}

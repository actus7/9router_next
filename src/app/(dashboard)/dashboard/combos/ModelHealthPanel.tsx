"use client";

import useSWR from "swr";
import { Activity, RotateCcw } from "lucide-react";
import Card from "@/shared/components/Card";
import { Button } from "@/components/ui/button";
import { InfoButton } from "@/shared/components/InfoButton";
import { jsonFetcher } from "@/shared/hooks/jsonFetcher";
import { translate } from "@/i18n/runtime";

type State = "ok" | "penalized" | "partial" | "cooldown";

interface HealthRow {
  model: string;
  state: State;
  penalty: number;
  successRate: number | null;
  samples: number;
  p50Ms: number | null;
  p95Ms: number | null;
  accounts: number;
  cooldownAccounts: number;
  cooldownUntil?: string;
  reason?: string;
}

function t(text: string): string {
  return translate(text) || text;
}

const PILL: Record<State, string> = {
  ok: "border-success/30 bg-success/10 text-success",
  penalized: "border-warning-border/30 bg-warning/10 text-warning",
  partial: "border-warning-border/30 bg-warning/10 text-warning",
  cooldown: "border-destructive/30 bg-destructive/10 text-destructive",
};

function stateLabel(row: HealthRow): string {
  switch (row.state) {
    case "cooldown": return t("In cooldown");
    case "partial": return `${t("Cooldown")} ${row.cooldownAccounts}/${row.accounts}`;
    case "penalized": return `${t("Penalized")} −${row.penalty}`;
    default: return t("Healthy");
  }
}

function seconds(ms: number | null): string {
  if (ms === null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s` : `${ms}ms`;
}

function clock(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

interface Props {
  /** Asks the page to confirm, then runs the reset. */
  onRequestReset: (run: () => Promise<void>) => void;
}

/**
 * What the gateway currently thinks of each model: who is cooling down and why,
 * who was moved later in the order, and what each one has actually delivered.
 */
export function ModelHealthPanel({ onRequestReset }: Props) {
  const { data, mutate, isLoading } = useSWR<{ models: HealthRow[] }>("/api/combos/health", jsonFetcher, { refreshInterval: 10_000 });
  const rows = data?.models ?? [];

  const reset = () => onRequestReset(async () => {
    await fetch("/api/combos/health/reset", { method: "POST" });
    await mutate();
  });

  return (
    <Card padding="sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-text-muted" aria-hidden />
          <h3 className="text-sm font-semibold text-text-main">{t("Model health")}</h3>
          <InfoButton label={t("Model health")}>
            <p>{t("Success rate and time to first response come from your own traffic over the last 7 days, recent attempts weighing more. A model that keeps failing is put in cooldown on all its accounts and recovers by itself.")}</p>
          </InfoButton>
        </div>
        <Button variant="outline" size="sm" onClick={reset} disabled={rows.length === 0} className="min-h-9">
          <RotateCcw data-icon="inline-start" />
          <span>{t("Reset")}</span>
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-muted">
          {isLoading ? t("Loading...") : t("No attempts recorded yet. Models appear here after they handle requests through a combo.")}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-border">
          {rows.map((row) => (
            <li key={row.model} className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto_5rem_8rem] sm:items-center">
              <code className="truncate font-mono text-xs text-text-main" title={row.model}>{row.model}</code>
              <span className={`w-fit rounded-full border px-2 py-0.5 text-[11px] font-medium ${PILL[row.state]}`} title={row.reason}>
                {stateLabel(row)}{row.cooldownUntil && row.state !== "penalized" ? ` · ${t("until")} ${clock(row.cooldownUntil)}` : ""}
              </span>
              <span className="text-xs text-text-muted sm:text-right" title={`${row.samples} ${t("attempts")}`}>
                {row.successRate === null ? "—" : `${Math.round(row.successRate * 100)}%`}
              </span>
              <span className="text-xs text-text-muted sm:text-right" title={t("Time to first response, p50 / p95")}>
                {seconds(row.p50Ms)} / {seconds(row.p95Ms)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

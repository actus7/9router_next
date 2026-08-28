"use client";

import Card from "@/shared/components/Card";
import { ArrowDownToLine, ArrowUpFromLine, DatabaseZap, DollarSign, Send } from "lucide-react";
import { translate } from "@/i18n/runtime";

interface OverviewStats {
  totalRequests?: number;
  totalPromptTokens?: number;
  totalCachedTokens?: number;
  totalCompletionTokens?: number;
  totalCost?: number;
}

interface OverviewCardsProps {
  stats: OverviewStats;
}

const fmt = (n?: number) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n?: number) => `$${(n || 0).toFixed(2)}`;

export default function OverviewCards({ stats }: OverviewCardsProps) {
  const SECONDARY_STATS = [
    { key: "totalRequests" as const, label: translate("Requests") || "Requests", hint: translate("Monitor your API usage, token consumption, and request logs") || undefined, icon: Send, color: "text-text-main" },
    { key: "totalPromptTokens" as const, label: translate("Input") || "Input", hint: translate("Input Tokens") || undefined, icon: ArrowUpFromLine, color: "text-primary" },
    { key: "totalCachedTokens" as const, label: translate("Cached") || "Cached", hint: translate("Cached Tokens") || undefined, icon: DatabaseZap, color: "text-info" },
    { key: "totalCompletionTokens" as const, label: translate("Output") || "Output", hint: translate("Output Tokens") || undefined, icon: ArrowDownToLine, color: "text-success" },
  ];
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-4">
      {/* Hero card: cost is the number people actually care about first */}
      <Card className="min-w-0" padding="md">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-text-muted text-sm font-semibold">{translate("Estimated cost for the period")}</span>
            <span className="truncate text-4xl font-bold text-warning">~{fmtCost(stats.totalCost)}</span>
            <span className="text-xs text-text-muted">{translate("Estimate based on provider token pricing — not a real charge.")}</span>
          </div>
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning">
            <DollarSign className="size-5" />
          </div>
        </div>
      </Card>

      {/* Secondary stats: same weight, quieter than the hero */}
      <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
        {SECONDARY_STATS.map(({ key, label, hint, icon: Icon, color }) => (
          <Card key={key} className="min-w-0" padding="sm">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="flex items-center gap-1.5 text-text-muted text-xs font-semibold uppercase tracking-wide">
                <Icon className="size-3.5 shrink-0" /> {label}
              </span>
              <span className={`truncate text-xl font-bold ${color}`}>{fmt(stats[key])}</span>
              <span className="truncate text-[10px] text-text-muted" title={hint}>{hint}</span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

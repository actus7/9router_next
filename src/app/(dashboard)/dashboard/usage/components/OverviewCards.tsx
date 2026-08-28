"use client";

import Card from "@/shared/components/Card";

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
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 sm:gap-4">
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-text-muted text-sm uppercase font-semibold">Total de Requisições</span>
        <span className="truncate text-2xl font-bold">{fmt(stats.totalRequests)}</span>
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-text-muted text-sm uppercase font-semibold">Total de Tokens de Entrada</span>
        <span className="truncate text-2xl font-bold text-primary">{fmt(stats.totalPromptTokens)}</span>
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-text-muted text-sm uppercase font-semibold">Tokens em Cache</span>
        <span className="truncate text-2xl font-bold text-info">{fmt(stats.totalCachedTokens)}</span>
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-text-muted text-sm uppercase font-semibold">Tokens de Saída</span>
        <span className="truncate text-2xl font-bold text-success">{fmt(stats.totalCompletionTokens)}</span>
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-text-muted text-sm uppercase font-semibold">Custo Est.</span>
        <span className="truncate text-2xl font-bold text-warning">~{fmtCost(stats.totalCost)}</span>
        <span className="text-[10px] text-text-muted">Estimado, não cobrança real</span>
      </Card>
    </div>
  );
}

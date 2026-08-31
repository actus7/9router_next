"use client";

import { Brain } from "lucide-react";
import { translate } from "@/i18n/runtime";
import type { RoutingInfo } from "./types";

interface Props {
  routing: RoutingInfo;
}

export default function RoutingPanel({ routing }: Props) {
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-main">
        <Brain className="size-4 text-primary" /> {translate("Smart routing")}
      </div>
      <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-text-muted">Tarefa</dt><dd className="mt-0.5 font-medium text-text-main">{routing.need}</dd></div>
        <div><dt className="text-text-muted">Tier</dt><dd className="mt-0.5 font-medium text-text-main">{routing.tier}</dd></div>
        <div><dt className="text-text-muted">{translate("Confidence")}</dt><dd className="mt-0.5 font-medium text-text-main">{Math.round((routing.confidence || 0) * 100)}%</dd></div>
        <div><dt className="text-text-muted">Motivo</dt><dd className="mt-0.5 font-medium text-text-main">{routing.reason}</dd></div>
      </dl>
      <p className="mt-3 truncate font-mono text-xs text-text-muted" title={routing.candidates?.[0]}>
        {routing.candidates?.[0] || "Sem candidato registrado"}
        {routing.degraded ? " · fallback degradado" : ""}
      </p>
    </div>
  );
}

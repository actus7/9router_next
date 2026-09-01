"use client";

import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2, Clock, HelpCircle } from "lucide-react";

interface StatusConfig {
  icon: React.ElementType;
  color: string;
  label: string;
}

const STATUS_CONFIG: Record<string, StatusConfig> = {
  available: { icon: CheckCircle2, color: "#22c55e", label: "Available" },
  cooldown: { icon: Clock, color: "#f59e0b", label: "Cooldown" },
  unavailable: { icon: AlertCircle, color: "#ef4444", label: "Unavailable" },
  unknown: { icon: HelpCircle, color: "#6b7280", label: "Unknown" },
};

export interface ModelStatus {
  provider?: string;
  model: string;
  status: string;
  until?: string;
  connectionName?: string;
  lastError?: string | null;
}

interface AvailabilityContentProps {
  models: ModelStatus[];
  isHealthy: boolean;
  clearing: string | null;
  onClearCooldown: (provider: string, model: string) => void;
}

export default function AvailabilityContent({ models, isHealthy, clearing, onClearCooldown }: AvailabilityContentProps) {
  const byProvider: Record<string, ModelStatus[]> = {};
  models.forEach((m) => {
    if (m.status === "available") return;
    const key = m.provider || "unknown";
    if (!byProvider[key]) byProvider[key] = [];
    byProvider[key].push(m);
  });

  if (isHealthy) {
    return <p className="text-sm text-text-muted text-center py-2">All models are responding normally.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-relaxed text-text-muted">
        These signals may apply to an individual model or to the whole provider connection.
      </p>
      {Object.entries(byProvider).map(([provider, provModels]) => (
        <div key={provider}>
          <p className="text-xs font-semibold text-text-main mb-1.5 capitalize">{provider}</p>
          <div className="flex flex-col gap-1">
            {provModels.map((m) => {
              const status = STATUS_CONFIG[m.status] || STATUS_CONFIG.unknown;
              const isClearing = clearing === `${m.provider}:${m.model}`;
              const affectsAllModels = m.model === "__all";
              const StatusIcon = status.icon;
              return (
                <div key={`${m.provider}-${m.model}`} className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-surface/30">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[14px] shrink-0" style={{ color: status.color }}>
                        <StatusIcon className="size-3.5" />
                      </span>
                      <span className="truncate text-xs font-medium text-text-main">{affectsAllModels ? "Connection unavailable" : status.label}</span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-text-muted">
                      {affectsAllModels ? `${m.connectionName || provider}: all models are affected` : m.model}
                    </p>
                    {m.lastError && (
                      <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-red-500/90 dark:text-red-300/90">
                        Last error: {m.lastError}
                      </p>
                    )}
                  </div>
                  {m.status === "cooldown" && (
                    <Button size="sm" variant="ghost" onClick={() => onClearCooldown(m.provider!, m.model)} disabled={isClearing} className="text-[10px] px-1.5! py-0.5! ml-2">
                      {isClearing ? "..." : "Clear"}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

"use client";

/**
 * ModelAvailabilityBadge — compact inline status indicator
 *
 * Shows green when all models are operational, or amber/red when there are
 * issues, with a popover for details and cooldown clearing.
 */

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle2, Clock, HelpCircle, RefreshCw, TriangleAlert } from "lucide-react";

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

interface ModelStatus {
  provider?: string;
  model: string;
  status: string;
  until?: string;
  connectionName?: string;
  lastError?: string | null;
}

interface AvailabilityData {
  models?: ModelStatus[];
  unavailableCount?: number;
}

export default function ModelAvailabilityBadge() {
  const [data, setData] = useState<AvailabilityData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [clearing, setClearing] = useState<string | null>(null);
  const notify = useNotificationStore();

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/models/availability");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // silent fail — will retry
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleClearCooldown = async (provider: string, model: string) => {
    setClearing(`${provider}:${model}`);
    try {
      const res = await fetch("/api/models/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clearCooldown", provider, model }),
      });
      if (res.ok) {
        notify.success(`Cooldown cleared for ${model}`);
        await fetchStatus();
      } else {
        notify.error("Failed to clear cooldown");
      }
    } catch {
      notify.error("Failed to clear cooldown");
    } finally {
      setClearing(null);
    }
  };

  if (loading) return null;

  const models = data?.models || [];
  const unavailableCount = data?.unavailableCount || models.filter((m) => m.status !== "available").length;
  const isHealthy = unavailableCount === 0;
  const hasUnavailableConnection = models.some((model) => model.status === "unavailable");

  // Group unhealthy models by provider
  const byProvider: Record<string, ModelStatus[]> = {};
  models.forEach((m) => {
    if (m.status === "available") return;
    const key = m.provider || "unknown";
    if (!byProvider[key]) byProvider[key] = [];
    byProvider[key].push(m);
  });

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
          isHealthy
            ? "bg-green-500/10 text-green-600 hover:bg-green-500/20"
            : hasUnavailableConnection
              ? "bg-red-500/10 text-red-600 hover:bg-red-500/20"
              : "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
        )}
      >
        {isHealthy ? (
          <CheckCircle2 className="size-3.5" />
        ) : (
          <TriangleAlert className="size-3.5" />
        )}
        <span>{isHealthy ? "All OK" : `${unavailableCount} need${unavailableCount === 1 ? "s" : ""} attention`}</span>
      </PopoverTrigger>

      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        className="w-80 p-0"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <span
              className="text-[16px]"
              style={{ color: isHealthy ? "#22c55e" : "#f59e0b" }}
            >
              {isHealthy ? <CheckCircle2 className="size-4" /> : <TriangleAlert className="size-4" />}
            </span>
            <span className="text-sm font-semibold text-text-main">Availability status</span>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={fetchStatus}
            className="text-text-muted hover:text-text-main"
            title="Refresh"
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>

        <div className="px-4 py-3 max-h-60 overflow-y-auto">
          {isHealthy ? (
            <p className="text-sm text-text-muted text-center py-2">
              All models are responding normally.
            </p>
          ) : (
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
                      const statusLabel = affectsAllModels
                        ? "Connection unavailable"
                        : status.label;
                      return (
                        <div
                          key={`${m.provider}-${m.model}`}
                          className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-surface/30"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                            <span
                              className="text-[14px] shrink-0"
                              style={{ color: status.color }}
                            >
                              {(() => { const StatusIcon = status.icon; return <StatusIcon className="size-3.5" />; })()}
                            </span>
                              <span className="truncate text-xs font-medium text-text-main">{statusLabel}</span>
                            </div>
                            <p className="mt-0.5 truncate text-[11px] text-text-muted">
                              {affectsAllModels
                                ? `${m.connectionName || provider}: all models are affected`
                                : m.model}
                            </p>
                            {m.lastError && (
                              <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-red-500/90 dark:text-red-300/90">
                                Last error: {m.lastError}
                              </p>
                            )}
                          </div>
                          {m.status === "cooldown" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleClearCooldown(m.provider!, m.model)}
                              disabled={isClearing}
                              className="text-[10px] px-1.5! py-0.5! ml-2"
                            >
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
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

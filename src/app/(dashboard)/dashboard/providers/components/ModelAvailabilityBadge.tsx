"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useNotificationStore } from "@/store/notificationStore";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CheckCircle2, RefreshCw, TriangleAlert } from "lucide-react";
import AvailabilityContent, { type ModelStatus } from "./AvailabilityContent";

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
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
    finally { setLoading(false); }
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
      if (res.ok) { notify.success(`Cooldown cleared for ${model}`); await fetchStatus(); }
      else notify.error("Failed to clear cooldown");
    } catch { notify.error("Failed to clear cooldown"); }
    finally { setClearing(null); }
  };

  if (loading) return null;

  const models = data?.models || [];
  const unavailableCount = data?.unavailableCount || models.filter((m) => m.status !== "available").length;
  const isHealthy = unavailableCount === 0;
  const hasUnavailableConnection = models.some((model) => model.status === "unavailable");

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
          isHealthy ? "bg-green-500/10 text-green-600 hover:bg-green-500/20"
            : hasUnavailableConnection ? "bg-red-500/10 text-red-600 hover:bg-red-500/20"
            : "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
        )}
      >
        {isHealthy ? <CheckCircle2 className="size-3.5" /> : <TriangleAlert className="size-3.5" />}
        <span>{isHealthy ? "All OK" : `${unavailableCount} need${unavailableCount === 1 ? "s" : ""} attention`}</span>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" sideOffset={8} className="w-80 p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <span className="text-[16px]" style={{ color: isHealthy ? "#22c55e" : "#f59e0b" }}>
              {isHealthy ? <CheckCircle2 className="size-4" /> : <TriangleAlert className="size-4" />}
            </span>
            <span className="text-sm font-semibold text-text-main">Availability status</span>
          </div>
          <Button variant="ghost" size="icon-xs" onClick={fetchStatus} className="text-text-muted hover:text-text-main" title="Refresh">
            <RefreshCw className="size-4" />
          </Button>
        </div>
        <div className="px-4 py-3 max-h-60 overflow-y-auto">
          <AvailabilityContent models={models} isHealthy={isHealthy} clearing={clearing} onClearCooldown={handleClearCooldown} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

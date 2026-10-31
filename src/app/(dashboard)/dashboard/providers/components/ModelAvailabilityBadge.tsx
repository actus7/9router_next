"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { notify } from "@/store/notificationStore";
import { translate } from "@/i18n/runtime";
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
  const [failed, setFailed] = useState<boolean>(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/models/availability");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setFailed(false);
    } catch { setFailed(true); }
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
      if (res.ok) { notify.success(`${translate("Cooldown cleared for") || "Cooldown cleared for"} ${model}`); await fetchStatus(); }
      else notify.error(translate("Failed to clear cooldown") || "Failed to clear cooldown");
    } catch { notify.error(translate("Failed to clear cooldown") || "Failed to clear cooldown"); }
    finally { setClearing(null); }
  };

  if (loading) return null;

  if (failed) {
    return (
      <button
        type="button"
        onClick={fetchStatus}
        title={translate("Try again") || "Try again"}
        className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors cursor-pointer hover:bg-muted/80"
      >
        <RefreshCw className="size-3.5" />
        <span>{translate("Status unavailable") || "Status unavailable"}</span>
      </button>
    );
  }

  const models = data?.models || [];
  const unavailableCount = data?.unavailableCount || models.filter((m) => m.status !== "available").length;
  const isHealthy = unavailableCount === 0;
  const hasUnavailableConnection = models.some((model) => model.status === "unavailable");

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
          isHealthy ? "bg-success text-success-foreground hover:bg-success"
            : hasUnavailableConnection ? "bg-destructive text-destructive-foreground hover:bg-destructive"
            : "bg-warning text-warning-foreground hover:bg-warning"
        )}
      >
        {isHealthy ? <CheckCircle2 className="size-3.5" /> : <TriangleAlert className="size-3.5" />}
        <span>{isHealthy ? "All OK" : `${unavailableCount} need${unavailableCount === 1 ? "s" : ""} attention`}</span>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" sideOffset={8} className="w-80 p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <span className={cn("text-[16px]", isHealthy ? "text-success" : "text-warning")}>
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

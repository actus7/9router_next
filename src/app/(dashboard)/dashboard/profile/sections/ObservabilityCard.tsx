"use client";

import { Card } from "@/shared/components";
import { Switch } from "@/components/ui/switch";
import { BarChart3 } from "lucide-react";
import { translate } from "@/i18n/runtime";

interface ObservabilityCardProps {
  observabilityEnabled: boolean;
  loading: boolean;
  updateObservabilityEnabled: (enabled: boolean) => Promise<void>;
}

export default function ObservabilityCard({
  observabilityEnabled, loading, updateObservabilityEnabled,
}: ObservabilityCardProps) {
  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-orange-500/10 text-orange-500 shrink-0">
          <BarChart3 className="size-5" />
        </div>
        <h3 className="text-base sm:text-lg font-semibold">{translate("Observability")}</h3>
      </div>
      <div className="flex items-start sm:items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm sm:text-base">{translate("Enable Observability")}</p>
          <p className="text-xs sm:text-sm text-text-muted">
            {translate("Record request details for inspection in the logs view")}
          </p>
        </div>
        <Switch
          checked={observabilityEnabled}
          onCheckedChange={updateObservabilityEnabled}
          disabled={loading}
        />
      </div>
    </Card>
  );
}

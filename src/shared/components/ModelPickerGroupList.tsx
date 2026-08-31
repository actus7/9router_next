"use client";

import { cn } from "@/lib/utils";
import ProviderIcon from "./ProviderIcon";
import CapacityBadges from "./CapacityBadges";
import { CAPACITY_META, type CapacityKey } from "@/shared/constants/models";
import { Check, Eye, Brain, RefreshCw } from "lucide-react";
import { translate } from "@/i18n/runtime";

interface NormalizedModel {
  id: string;
  requestModel: string;
  name: string;
  providerId: string;
  providerName: string;
  source: string;
  caps?: Record<string, boolean>;
  kind?: string;
}

const CAP_ICONS: Record<string, React.ReactNode> = {
  vision: <Eye className="size-3.5" />,
  reasoning: <Brain className="size-3.5" />,
};

interface ModelPickerGroupListProps {
  filteredGroups: { providerId: string; providerName: string; models: NormalizedModel[] }[];
  activeModelId: string;
  onSelect: (modelId: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCaps: (requestModel: string) => any;
  loading: boolean;
  error: string;
  search: string;
}

export default function ModelPickerGroupList({
  filteredGroups,
  activeModelId,
  onSelect,
  getCaps,
  loading,
  error,
  search,
}: ModelPickerGroupListProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="size-4 animate-spin" />
          {translate("Loading models...") || "Loading models..."}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (filteredGroups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <Check className="size-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          {search.trim()
            ? translate("No models match your search.") || "No models match your search."
            : translate("No models available.") || "No models available."}
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Table header */}
      <div className="flex items-center gap-3 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="flex-1 min-w-0">Model</span>
        <span className="shrink-0 w-20 text-center">Capabilities</span>
        <span className="shrink-0 w-20 text-right">Status</span>
      </div>

      {filteredGroups.map((group) => (
        <div key={group.providerId} className="mb-1">
          {/* Provider header */}
          <div className="flex items-center gap-2 px-3 py-2 sticky top-0 bg-background/95 backdrop-blur-sm z-10">
            <ProviderIcon
              providerId={group.providerId}
              size={18}
              fallbackText={group.providerName.charAt(0)}
            />
            <span className="text-xs font-semibold text-foreground">{group.providerName}</span>
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
              <Check className="size-3" /> Connected
            </span>
            <span className="text-[10px] text-muted-foreground ml-auto">
              {group.models.length} model{group.models.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Model rows */}
          <div className="flex flex-col gap-px">
            {group.models.map((model) => {
              const isActive = model.id === activeModelId;
              const caps = getCaps(model.requestModel) || model.caps;
              const activeCaps = caps
                ? (Object.keys(CAPACITY_META) as CapacityKey[]).filter((k) => caps[k])
                : [];

              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => onSelect(model.id)}
                  className={cn(
                    "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors w-full",
                    isActive
                      ? "bg-primary/10 ring-1 ring-primary/20"
                      : "hover:bg-muted/60"
                  )}
                >
                  {/* Model name */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {model.name}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate font-mono">
                      {model.requestModel}
                    </p>
                  </div>

                  {/* Capabilities */}
                  <div className="shrink-0 w-20 flex items-center justify-center">
                    {activeCaps.length > 0 ? (
                      <CapacityBadges caps={caps} size={14} />
                    ) : (
                      <span className="text-[10px] text-muted-foreground/40">—</span>
                    )}
                  </div>

                  {/* Availability */}
                  <div className="shrink-0 w-20 flex items-center justify-end">
                    <span className={cn(
                      "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                      model.source === "configured"
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "bg-muted text-muted-foreground"
                    )}>
                      {model.source === "configured" ? "Configured" : "Available"}
                    </span>
                  </div>

                  {/* Active indicator */}
                  {isActive && (
                    <Check className="size-4 shrink-0 text-primary" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

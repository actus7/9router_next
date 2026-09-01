"use client";

import ProviderIcon from "./ProviderIcon";
import { Check, RefreshCw } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { ModelRow } from "./ModelRow";

interface NormalizedModel {
  id: string; requestModel: string; name: string; providerId: string;
  providerName: string; source: string; caps?: Record<string, boolean>; kind?: string;
}

interface ModelPickerGroupListProps {
  filteredGroups: { providerId: string; providerName: string; models: NormalizedModel[] }[];
  activeModelId: string; onSelect: (modelId: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCaps: (requestModel: string) => any;
  loading: boolean; error: string; search: string;
}

export default function ModelPickerGroupList({ filteredGroups, activeModelId, onSelect, getCaps, loading, error, search }: ModelPickerGroupListProps) {
  if (loading) return (<div className="flex items-center justify-center py-12"><div className="flex items-center gap-2 text-sm text-muted-foreground"><RefreshCw className="size-4 animate-spin" />{translate("Loading models...") || "Loading models..."}</div></div>);
  if (error) return (<div className="flex items-center justify-center py-12"><p className="text-sm text-destructive">{error}</p></div>);
  if (filteredGroups.length === 0) return (<div className="flex flex-col items-center justify-center py-12 gap-3"><Check className="size-8 text-muted-foreground/40" /><p className="text-sm text-muted-foreground">{search.trim() ? translate("No models match your search.") || "No models match your search." : translate("No models available.") || "No models available."}</p></div>);

  return (
    <>
      <div className="flex items-center gap-3 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="flex-1 min-w-0">Model</span><span className="shrink-0 w-20 text-center">Capabilities</span><span className="shrink-0 w-20 text-right">Status</span>
      </div>
      {filteredGroups.map((group) => (
        <div key={group.providerId} className="mb-1">
          <div className="flex items-center gap-2 px-3 py-2 sticky top-0 bg-background/95 backdrop-blur-sm z-10">
            <ProviderIcon providerId={group.providerId} size={18} fallbackText={group.providerName.charAt(0)} />
            <span className="text-xs font-semibold text-foreground">{group.providerName}</span>
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400"><Check className="size-3" /> Connected</span>
            <span className="text-[10px] text-muted-foreground ml-auto">{group.models.length} model{group.models.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="flex flex-col gap-px">
            {group.models.map((model) => <ModelRow key={model.id} model={model} activeModelId={activeModelId} onSelect={onSelect} getCaps={getCaps} />)}
          </div>
        </div>
      ))}
    </>
  );
}

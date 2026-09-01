"use client";

import { cn } from "@/lib/utils";
import { Eye, Brain, Key, Users, Monitor } from "lucide-react";
import type { AuthTab } from "./useModelPickerFilters";
import { TAB_DEFS } from "./useModelPickerFilters";

const TAB_ICONS: Record<string, React.ReactNode> = {
  subscription: <Users className="size-3.5 text-emerald-400" />,
  apikey: <Key className="size-3.5 text-warning-foreground" />,
  local: <Monitor className="size-3.5 text-pink-400" />,
};

export const CAP_ICONS: Record<string, React.ReactNode> = {
  vision: <Eye className="size-3.5" />,
  reasoning: <Brain className="size-3.5" />,
};

export const CAP_LABELS: Record<string, string> = {
  vision: "Vision",
  reasoning: "Reasoning",
};

interface PickerTabsProps {
  activeTab: AuthTab; setActiveTab: (t: AuthTab) => void;
  tabCounts: Record<AuthTab, number>; hasMultipleTabs: boolean;
}

export function PickerTabs({ activeTab, setActiveTab, tabCounts, hasMultipleTabs }: PickerTabsProps) {
  if (!hasMultipleTabs) return null;
  return (
    <div className="shrink-0 border-b border-border px-4 pt-2">
      <div className="flex gap-1" role="tablist">
        {TAB_DEFS.map((tab) => {
          const count = tabCounts[tab.key];
          if (count === 0) return null;
          return (
            <button key={tab.key} role="tab" aria-selected={activeTab === tab.key} onClick={() => setActiveTab(tab.key)}
              className={cn("flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors", activeTab === tab.key ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}>
              {TAB_ICONS[tab.key]}{tab.label}<span className="ml-0.5 text-[10px] text-muted-foreground">({count})</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface CapFilterPillsProps { availableCaps: string[]; capFilter: Set<string>; toggleCap: (c: string) => void; }

export function CapFilterPills({ availableCaps, capFilter, toggleCap }: CapFilterPillsProps) {
  if (availableCaps.length === 0) return null;
  return (
    <div className="shrink-0 flex items-center gap-1.5 border-b border-border px-4 py-2">
      {availableCaps.map((cap) => (
        <button key={cap} type="button" onClick={() => toggleCap(cap)}
          className={cn("flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors border", capFilter.has(cap) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground")}>
          {CAP_ICONS[cap]}{CAP_LABELS[cap] || cap}
        </button>
      ))}
    </div>
  );
}

"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import ProviderIcon from "./ProviderIcon";
import CapacityBadges from "./CapacityBadges";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { CAPACITY_META, type CapacityKey } from "@/shared/constants/models";
import {
  AI_PROVIDERS,
  OAUTH_PROVIDERS,
  APIKEY_PROVIDERS,
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider,
} from "@/shared/constants/providers";
import { Check, Eye, Brain, Key, Users, Monitor, Search, X, RefreshCw, Zap } from "lucide-react";
import { translate } from "@/i18n/runtime";

// ─── Types ───────────────────────────────────────────────────────────────────

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

interface ProviderGroup {
  providerId: string;
  providerName: string;
  providerType: string;
  connections: Array<Record<string, unknown>>;
  models: NormalizedModel[];
}

type AuthTab = "subscription" | "apikey" | "local";

interface ModelPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerGroups: ProviderGroup[];
  activeModelId: string;
  onSelect: (modelId: string) => void;
  loading?: boolean;
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const OAUTH_PROVIDER_IDS = new Set(Object.keys(OAUTH_PROVIDERS));
const FREE_PROVIDER_IDS = new Set([...Object.keys(FREE_PROVIDERS), ...Object.keys(FREE_TIER_PROVIDERS)]);

function classifyProvider(providerId: string): AuthTab {
  if (FREE_PROVIDER_IDS.has(providerId)) return "local";
  if (OAUTH_PROVIDER_IDS.has(providerId)) return "subscription";
  return "apikey";
}

const CAP_ICONS: Record<string, React.ReactNode> = {
  vision: <Eye className="size-3.5" />,
  reasoning: <Brain className="size-3.5" />,
};

const CAP_LABELS: Record<string, string> = {
  vision: "Vision",
  reasoning: "Reasoning",
};

const TAB_DEFS: { key: AuthTab; label: string; icon: React.ReactNode }[] = [
  { key: "subscription", label: "Subscription", icon: <Users className="size-3.5 text-emerald-400" /> },
  { key: "apikey", label: "Usage-based", icon: <Key className="size-3.5 text-amber-400" /> },
  { key: "local", label: "Local / Free", icon: <Monitor className="size-3.5 text-pink-400" /> },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function ModelPickerModal({
  open,
  onOpenChange,
  providerGroups,
  activeModelId,
  onSelect,
  loading = false,
  error = "",
}: ModelPickerModalProps) {
  const { getCaps } = useModelCaps();
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<AuthTab>("apikey");
  const [capFilter, setCapFilter] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  // Classify which tabs have models
  const tabCounts = useMemo(() => {
    const counts: Record<AuthTab, number> = { subscription: 0, apikey: 0, local: 0 };
    for (const group of providerGroups) {
      const tab = classifyProvider(group.providerId);
      counts[tab] += group.models.length;
    }
    return counts;
  }, [providerGroups]);

  const hasMultipleTabs = useMemo(() => {
    return Object.values(tabCounts).filter((c) => c > 0).length > 1;
  }, [tabCounts]);

  // Auto-select the first tab with models
  useEffect(() => {
    if (!open) return;
    if (tabCounts[activeTab] > 0) return;
    const first = TAB_DEFS.find((t) => tabCounts[t.key] > 0);
    if (first) setActiveTab(first.key);
  }, [open, tabCounts, activeTab]);

  // Focus search on open
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 100);
    } else {
      setSearch("");
      setCapFilter(new Set());
    }
  }, [open]);

  // Available capabilities across visible models
  const availableCaps = useMemo(() => {
    const found = new Set<string>();
    for (const group of providerGroups) {
      for (const model of group.models) {
        const caps = getCaps(model.requestModel) || model.caps;
        if (caps) {
          for (const [k, v] of Object.entries(caps)) {
            if (v) found.add(k);
          }
        }
      }
    }
    return Array.from(found).filter((k) => k in CAP_ICONS);
  }, [providerGroups, getCaps]);

  // Filter and group models
  const filteredGroups = useMemo(() => {
    const q = search.toLowerCase().trim();
    const tab = activeTab;

    const groups: { providerId: string; providerName: string; models: NormalizedModel[] }[] = [];

    for (const group of providerGroups) {
      // Filter by tab
      const groupTab = classifyProvider(group.providerId);
      if (hasMultipleTabs && groupTab !== tab) continue;

      // Filter models
      let models = group.models;

      // Apply capability filter
      if (capFilter.size > 0) {
        models = models.filter((model) => {
          const caps = (getCaps(model.requestModel) || model.caps) as Record<string, boolean> | undefined;
          if (!caps) return false;
          for (const cap of capFilter) {
            if (!caps[cap]) return false;
          }
          return true;
        });
      }

      // Apply search
      if (q) {
        const nameMatch = group.providerName.toLowerCase().includes(q);
        models = nameMatch
          ? models
          : models.filter(
              (m) =>
                m.name.toLowerCase().includes(q) ||
                m.requestModel.toLowerCase().includes(q)
            );
      }

      if (models.length > 0) {
        groups.push({
          providerId: group.providerId,
          providerName: group.providerName,
          models: models.sort((a, b) => a.name.localeCompare(b.name)),
        });
      }
    }

    return groups.sort((a, b) => a.providerName.localeCompare(b.providerName));
  }, [providerGroups, search, activeTab, capFilter, getCaps, hasMultipleTabs]);

  const totalModels = useMemo(
    () => filteredGroups.reduce((sum, g) => sum + g.models.length, 0),
    [filteredGroups]
  );

  const toggleCap = useCallback((cap: string) => {
    setCapFilter((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) next.delete(cap);
      else next.add(cap);
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (modelId: string) => {
      onSelect(modelId);
      onOpenChange(false);
    },
    [onSelect, onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 p-0 overflow-hidden max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="shrink-0 border-b border-border px-5 py-4">
          <DialogTitle className="text-base font-semibold">
            {translate("Select a model") || "Select a model"}
          </DialogTitle>
        </div>

        {/* Tabs */}
        {hasMultipleTabs && (
          <div className="shrink-0 border-b border-border px-4 pt-2">
            <div className="flex gap-1" role="tablist">
              {TAB_DEFS.map((tab) => {
                const count = tabCounts[tab.key];
                if (count === 0) return null;
                const isActive = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveTab(tab.key)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                      isActive
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                  >
                    {tab.icon}
                    {tab.label}
                    <span className="ml-0.5 text-[10px] text-muted-foreground">({count})</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Search */}
        <div className="shrink-0 border-b border-border px-4 py-3">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={translate("Search models or providers...") || "Search models or providers..."}
              className="h-9 pl-8 pr-8"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Capability filter pills */}
        {availableCaps.length > 0 && (
          <div className="shrink-0 flex items-center gap-1.5 border-b border-border px-4 py-2">
            {availableCaps.map((cap) => {
              const isActive = capFilter.has(cap);
              return (
                <button
                  key={cap}
                  type="button"
                  onClick={() => toggleCap(cap)}
                  className={cn(
                    "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors border",
                    isActive
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground"
                  )}
                >
                  {CAP_ICONS[cap]}
                  {CAP_LABELS[cap] || cap}
                </button>
              );
            })}
          </div>
        )}

        {/* Model list */}
        <div className="flex-1 min-h-0 overflow-y-auto p-2 custom-scrollbar">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="size-4 animate-spin" />
                {translate("Loading models...") || "Loading models..."}
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Search className="size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {search.trim()
                  ? translate("No models match your search.") || "No models match your search."
                  : translate("No models available.") || "No models available."}
              </p>
            </div>
          ) : (
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
                          onClick={() => handleSelect(model.id)}
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

                          {/* Availability comes from a configured fallback or live discovery. */}
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
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border px-4 py-2 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            {totalModels} model{totalModels !== 1 ? "s" : ""} available
          </span>
          <span className="text-[11px] text-muted-foreground">
            {translate("From connected providers") || "From connected providers"}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

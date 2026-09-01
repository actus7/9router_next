"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import ProviderIcon from "./ProviderIcon";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS } from "@/shared/constants/providers";
import { cn } from "@/lib/utils";
import { Search, SearchX, X } from "lucide-react";
import type { ActiveProvider } from "./ModelSelectModal";
import { translate } from "@/i18n/runtime";
import { buildProviderGroups } from "./buildProviderGroups";
import { ProviderSidebar, priceTierBadge, priceLine } from "./TierModelPickerParts";

const PROVIDER_ORDER = [...Object.keys(OAUTH_PROVIDERS), ...Object.keys(FREE_PROVIDERS), ...Object.keys(FREE_TIER_PROVIDERS), ...Object.keys(APIKEY_PROVIDERS)];
const NO_AUTH_PROVIDER_IDS = Object.keys(FREE_PROVIDERS).filter((id) => (FREE_PROVIDERS as Record<string, { noAuth?: boolean }>)[id].noAuth);

export interface ModelPriceInfo { inputPrice: number | null; outputPrice: number | null; }

interface TierModelPickerModalProps {
  isOpen: boolean; onClose: () => void; onSelect: (value: string) => void;
  title: string; subtitle?: string; activeProviders?: ActiveProvider[];
  modelAliases?: Record<string, string>; addedModelValues?: string[]; priceByModel?: Record<string, ModelPriceInfo>;
}

export default function TierModelPickerModal({ isOpen, onClose, onSelect, title, subtitle = translate("The fallback is used when the model above fails or is unavailable.") || "The fallback is used when the model above fails or is unavailable.", activeProviders = [], modelAliases = {}, addedModelValues = [], priceByModel = {} }: TierModelPickerModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [providerNodes, setProviderNodes] = useState<{ id: string; name?: string; prefix?: string }[]>([]);
  const [customModels, setCustomModels] = useState<{ id: string; name?: string; providerAlias?: string }[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/provider-nodes").then((r) => r.json()).then((d) => setProviderNodes(d.nodes || [])).catch(() => setProviderNodes([]));
    fetch("/api/models/custom").then((r) => r.json()).then((d) => setCustomModels(d.models || [])).catch(() => setCustomModels([]));
  }, [isOpen]);
  useEffect(() => { if (!isOpen) { setSearchQuery(""); setSelectedProviderId(null); } }, [isOpen]);

  const allProviders = useMemo(() => ({ ...OAUTH_PROVIDERS, ...FREE_PROVIDERS, ...FREE_TIER_PROVIDERS, ...APIKEY_PROVIDERS }), []);
  const availableProviderIds = useMemo(() => {
    const activeIds = activeProviders.map((p) => p.provider);
    return [...new Set([...activeIds, ...NO_AUTH_PROVIDER_IDS])].sort((a, b) => (PROVIDER_ORDER.indexOf(a) === -1 ? 999 : PROVIDER_ORDER.indexOf(a)) - (PROVIDER_ORDER.indexOf(b) === -1 ? 999 : PROVIDER_ORDER.indexOf(b)));
  }, [activeProviders]);

  const groups = useMemo(() => buildProviderGroups({ sortedProviderIds: availableProviderIds, allProviders, activeProviders, modelAliases, providerNodes, customModels }), [activeProviders, modelAliases, allProviders, providerNodes, customModels, availableProviderIds]);
  const totalCount = useMemo(() => Object.values(groups).reduce((s, g) => s + g.models.length, 0), [groups]);
  const query = searchQuery.trim().toLowerCase();

  const visibleGroups = useMemo(() => {
    return Object.entries(groups).filter(([pid]) => !selectedProviderId || pid === selectedProviderId)
      .map(([pid, group]) => [pid, { ...group, models: query ? group.models.filter((m) => m.name.toLowerCase().includes(query) || m.id.toLowerCase().includes(query)) : group.models }] as const)
      .filter(([, g]) => g.models.length > 0);
  }, [groups, selectedProviderId, query]);

  const sortedProviderIds = useMemo(() => Object.keys(groups).sort((a, b) => (PROVIDER_ORDER.indexOf(a) === -1 ? 999 : PROVIDER_ORDER.indexOf(a)) - (PROVIDER_ORDER.indexOf(b) === -1 ? 999 : PROVIDER_ORDER.indexOf(b))), [groups]);

  const flatModelsSorted = useMemo(() => {
    if (!selectedProviderId) return null;
    const group = groups[selectedProviderId];
    if (!group) return [];
    const models = query ? group.models.filter((m) => m.name.toLowerCase().includes(query) || m.id.toLowerCase().includes(query)) : group.models;
    return [...models].sort((a, b) => (priceByModel[a.value]?.outputPrice ?? Infinity) - (priceByModel[b.value]?.outputPrice ?? Infinity));
  }, [selectedProviderId, groups, query, priceByModel]);

  const renderModelRow = (providerId: string, model: { id: string; name: string; value: string }) => {
    const isUsed = addedModelValues.includes(model.value);
    const badge = priceTierBadge(priceByModel[model.value]);
    return (
      <button key={model.value} type="button" disabled={isUsed} onClick={() => onSelect(model.value)} className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors", isUsed ? "cursor-not-allowed opacity-50" : "hover:bg-muted")}>
        {!selectedProviderId && <ProviderIcon providerId={providerId} alt={model.name} size={20} fallbackText={providerId.slice(0, 2).toUpperCase()} />}
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-text-main">{model.name}</p><p className="truncate text-xs text-text-muted">{priceLine(priceByModel[model.value])}</p></div>
        {isUsed ? <span className="shrink-0 text-xs text-text-muted">{translate("already used") || "already used"}</span> : badge ? <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", badge.className)}>{badge.label}</span> : null}
      </button>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className={cn("bg-surface border border-border-subtle rounded-[14px]", "shadow-[var(--shadow-elev)] ring-0 gap-0 p-0", "max-w-3xl")}>
        <div className="flex items-start justify-between gap-3 border-b border-border-subtle p-4">
          <div className="min-w-0"><DialogTitle className="text-lg font-semibold text-text-main">{title}</DialogTitle><p className="mt-0.5 text-sm text-text-muted">{subtitle}</p></div>
          <Button onClick={onClose} aria-label={translate("Close") || "Close"} variant="ghost" size="icon-sm" className="shrink-0"><X className="size-5" /></Button>
        </div>
        <div className="border-b border-border-subtle p-4">
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" /><Input type="text" placeholder={translate("Search by model or provider...") || "Search by model or provider..."} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" /></div>
        </div>
        <div className="flex max-h-[60vh] min-h-0">
          <ProviderSidebar sortedProviderIds={sortedProviderIds} groups={groups} selectedProviderId={selectedProviderId} totalCount={totalCount} onSelect={setSelectedProviderId} />
          <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
            {selectedProviderId ? (flatModelsSorted || []).map((m) => renderModelRow(selectedProviderId, m)) : visibleGroups.map(([pid, g]) => (
              <div key={pid} className="mb-3">
                <div className="sticky top-0 flex items-center gap-1.5 bg-surface px-3 py-1.5 text-xs font-medium text-text-muted"><ProviderIcon providerId={pid} alt={g.name} size={14} fallbackText={pid.slice(0, 2).toUpperCase()} /><span className="uppercase">{g.name}</span><span>· {g.models.length}</span></div>
                {g.models.map((m) => renderModelRow(pid, m))}
              </div>
            ))}
            {(selectedProviderId ? (flatModelsSorted || []).length === 0 : visibleGroups.length === 0) && (<div className="flex flex-col items-center gap-2 py-10 text-text-muted"><SearchX className="size-5" /><p className="text-sm">{translate("No models found") || "No models found"}</p></div>)}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

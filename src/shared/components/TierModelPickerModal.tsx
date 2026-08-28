"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import Button from "@/shared/components/Button";
import ProviderIcon from "./ProviderIcon";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS, isOpenAICompatibleProvider, isAnthropicCompatibleProvider, getProviderAlias } from "@/shared/constants/providers";
import { cn } from "@/lib/utils";
import { Search, SearchX, X } from "lucide-react";
import type { ActiveProvider } from "./ModelSelectModal";

type RawModel = { id: string; name: string; [key: string]: unknown };

const PROVIDER_ORDER = [
  ...Object.keys(OAUTH_PROVIDERS),
  ...Object.keys(FREE_PROVIDERS),
  ...Object.keys(FREE_TIER_PROVIDERS),
  ...Object.keys(APIKEY_PROVIDERS),
];

const NO_AUTH_PROVIDER_IDS = Object.keys(FREE_PROVIDERS).filter((id) => (FREE_PROVIDERS as Record<string, { noAuth?: boolean }>)[id].noAuth);

interface PickerModel {
  id: string;
  name: string;
  value: string;
}

interface PickerGroup {
  name: string;
  color: string;
  models: PickerModel[];
}

export interface ModelPriceInfo {
  inputPrice: number | null;
  outputPrice: number | null;
}

interface TierModelPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (value: string) => void;
  title: string;
  subtitle?: string;
  activeProviders?: ActiveProvider[];
  modelAliases?: Record<string, string>;
  addedModelValues?: string[];
  priceByModel?: Record<string, ModelPriceInfo>;
}

function fmtPrice(n: number): string {
  return `$${n.toFixed(n < 1 ? 3 : 2)}`;
}

// ponytail: price bands are a display heuristic (output price only), not a pricing policy
function priceTierBadge(price: ModelPriceInfo | undefined): { label: string; className: string } | null {
  if (!price || price.outputPrice === null) return null;
  const output = price.outputPrice;
  if (output === 0) return { label: "grátis", className: "bg-emerald-500/15 text-emerald-500" };
  if (output <= 0.5) return { label: "barato", className: "bg-emerald-500/15 text-emerald-500" };
  if (output <= 4) return { label: "médio", className: "bg-amber-500/15 text-amber-500" };
  return { label: "caro", className: "bg-red-500/15 text-red-500" };
}

function priceLine(price: ModelPriceInfo | undefined): string {
  if (!price || price.inputPrice === null || price.outputPrice === null) return "preço não catalogado";
  return `${fmtPrice(price.inputPrice)} entrada · ${fmtPrice(price.outputPrice)} saída / 1M`;
}

export default function TierModelPickerModal({
  isOpen,
  onClose,
  onSelect,
  title,
  subtitle = "O fallback é usado quando o modelo acima falha ou está indisponível.",
  activeProviders = [],
  modelAliases = {},
  addedModelValues = [],
  priceByModel = {},
}: TierModelPickerModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [providerNodes, setProviderNodes] = useState<{ id: string; name?: string; prefix?: string }[]>([]);
  const [customModels, setCustomModels] = useState<{ id: string; name?: string; providerAlias?: string }[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/provider-nodes").then((r) => r.json()).then((data) => setProviderNodes(data.nodes || [])).catch(() => setProviderNodes([]));
    fetch("/api/models/custom").then((r) => r.json()).then((data) => setCustomModels(data.models || [])).catch(() => setCustomModels([]));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) { setSearchQuery(""); setSelectedProviderId(null); }
  }, [isOpen]);

  const allProviders = useMemo(() => ({ ...OAUTH_PROVIDERS, ...FREE_PROVIDERS, ...FREE_TIER_PROVIDERS, ...APIKEY_PROVIDERS }), []);

  const groups = useMemo(() => {
    const result: Record<string, PickerGroup> = {};
    const activeIds = activeProviders.map((p) => p.provider);
    const providerIds = new Set([...activeIds, ...NO_AUTH_PROVIDER_IDS]);
    const sortedIds = [...providerIds].sort((a, b) => {
      const indexA = PROVIDER_ORDER.indexOf(a);
      const indexB = PROVIDER_ORDER.indexOf(b);
      return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
    });

    sortedIds.forEach((providerId) => {
      const alias = getProviderAlias(providerId);
      const providerInfo = (allProviders as Record<string, Record<string, unknown>>)[providerId] || { name: providerId, color: "#666" };
      const isCustomProvider = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);

      if (providerInfo.passthroughModels) {
        const aliasModels = Object.entries(modelAliases)
          .filter(([, fullModel]) => fullModel.startsWith(`${alias}/`))
          .map(([aliasName, fullModel]) => ({ id: fullModel.replace(`${alias}/`, ""), name: aliasName, value: fullModel }));
        const customRegistered = customModels
          .filter((m) => m.providerAlias === alias)
          .map((m) => ({ id: m.id, name: m.name || m.id, value: `${alias}/${m.id}` }));
        const registeredLlms = customRegistered.filter((m) => !getModelKind(m as unknown as Record<string, unknown>) || getModelKind(m as unknown as Record<string, unknown>) === "llm");
        const seen = new Set([...aliasModels, ...registeredLlms].map((m) => m.value));
        const hardcoded = (getModelsByProviderId(providerId) as RawModel[])
          .filter((m: RawModel) => !getModelKind(m) || getModelKind(m) === "llm")
          .map((m: RawModel) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}` }))
          .filter((m) => !seen.has(m.value));
        const models = [...registeredLlms, ...aliasModels.filter((m) => !registeredLlms.some((r) => r.value === m.value)), ...hardcoded];
        if (models.length > 0) {
          const matchedNode = providerNodes.find((node) => node.id === providerId);
          result[providerId] = { name: matchedNode?.name || (providerInfo.name as string), color: providerInfo.color as string, models };
        }
      } else if (isCustomProvider) {
        const connection = activeProviders.find((p) => p.provider === providerId);
        const matchedNode = providerNodes.find((node) => node.id === providerId);
        const displayName = matchedNode?.name || connection?.name || (providerInfo.name as string);
        const nodePrefix = (connection?.providerSpecificData?.prefix as string) || matchedNode?.prefix || providerId;
        const nodeModels = Object.entries(modelAliases)
          .filter(([, fullModel]) => fullModel.startsWith(`${providerId}/`))
          .map(([aliasName, fullModel]) => ({ id: fullModel.replace(`${providerId}/`, ""), name: aliasName, value: `${nodePrefix}/${fullModel.replace(`${providerId}/`, "")}` }));
        const registeredCustom = customModels
          .filter((m) => m.providerAlias === providerId)
          .map((m) => ({ id: m.id, name: m.name || m.id, value: `${nodePrefix}/${m.id}` }));
        const seen = new Set(nodeModels.map((m) => m.value));
        const models = [...nodeModels, ...registeredCustom.filter((m) => !seen.has(m.value))];
        if (models.length > 0) result[providerId] = { name: displayName, color: providerInfo.color as string, models };
      } else {
        const hardcodedModels = getModelsByProviderId(providerId) as RawModel[];
        const hardcodedIds = new Set(hardcodedModels.map((m) => m.id));
        const hasHardcoded = hardcodedModels.length > 0;
        const customAliasModels = Object.entries(modelAliases)
          .filter(([aliasName, fullModel]) => fullModel.startsWith(`${alias}/`) && (hasHardcoded ? aliasName === fullModel.replace(`${alias}/`, "") : true) && !hardcodedIds.has(fullModel.replace(`${alias}/`, "")))
          .map(([aliasName, fullModel]) => ({ id: fullModel.replace(`${alias}/`, ""), name: aliasName, value: fullModel }));
        const customAliasIds = new Set(customAliasModels.map((m) => m.id));
        const customRegistered = customModels
          .filter((m) => m.providerAlias === alias && !hardcodedIds.has(m.id) && !customAliasIds.has(m.id))
          .map((m) => ({ id: m.id, name: m.name || m.id, value: `${alias}/${m.id}` }));
        const merged: PickerModel[] = [
          ...hardcodedModels.filter((m) => !getModelKind(m) || getModelKind(m) === "llm").map((m) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}` })),
          ...customAliasModels,
          ...customRegistered,
        ];
        const seen = new Set<string>();
        const models = merged.filter((m) => { if (seen.has(m.value)) return false; seen.add(m.value); return true; });
        if (models.length > 0) result[providerId] = { name: providerInfo.name as string, color: providerInfo.color as string, models };
      }
    });

    return result;
  }, [activeProviders, modelAliases, allProviders, providerNodes, customModels]);

  const totalCount = useMemo(() => Object.values(groups).reduce((sum, group) => sum + group.models.length, 0), [groups]);

  const query = searchQuery.trim().toLowerCase();
  const visibleGroups = useMemo(() => {
    const entries = Object.entries(groups).filter(([providerId]) => !selectedProviderId || providerId === selectedProviderId);
    return entries
      .map(([providerId, group]) => {
        const models = query
          ? group.models.filter((m) => m.name.toLowerCase().includes(query) || m.id.toLowerCase().includes(query))
          : group.models;
        return [providerId, { ...group, models }] as const;
      })
      .filter(([, group]) => group.models.length > 0);
  }, [groups, selectedProviderId, query]);

  const sortedProviderIds = useMemo(
    () => Object.keys(groups).sort((a, b) => {
      const indexA = PROVIDER_ORDER.indexOf(a);
      const indexB = PROVIDER_ORDER.indexOf(b);
      return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
    }),
    [groups],
  );

  const flatModelsSorted = useMemo(() => {
    if (!selectedProviderId) return null;
    const group = groups[selectedProviderId];
    if (!group) return [];
    const models = query ? group.models.filter((m) => m.name.toLowerCase().includes(query) || m.id.toLowerCase().includes(query)) : group.models;
    return [...models].sort((a, b) => {
      const priceA = priceByModel[a.value]?.outputPrice ?? Infinity;
      const priceB = priceByModel[b.value]?.outputPrice ?? Infinity;
      return priceA - priceB;
    });
  }, [selectedProviderId, groups, query, priceByModel]);

  const renderModelRow = (providerId: string, model: PickerModel) => {
    const isUsed = addedModelValues.includes(model.value);
    const badge = priceTierBadge(priceByModel[model.value]);
    return (
      <button
        key={model.value}
        type="button"
        disabled={isUsed}
        onClick={() => onSelect(model.value)}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
          isUsed ? "cursor-not-allowed opacity-50" : "hover:bg-muted",
        )}
      >
        {!selectedProviderId && (
          <ProviderIcon providerId={providerId} alt={model.name} size={20} fallbackText={providerId.slice(0, 2).toUpperCase()} />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text-main">{model.name}</p>
          <p className="truncate text-xs text-text-muted">{priceLine(priceByModel[model.value])}</p>
        </div>
        {isUsed ? (
          <span className="shrink-0 text-xs text-text-muted">já usado</span>
        ) : badge ? (
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", badge.className)}>{badge.label}</span>
        ) : null}
      </button>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className={cn("bg-surface border border-border-subtle rounded-[14px]", "shadow-[var(--shadow-elev)] ring-0 gap-0 p-0", "max-w-3xl")}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-subtle p-4">
          <div className="min-w-0">
            <DialogTitle className="text-lg font-semibold text-text-main">{title}</DialogTitle>
            <p className="mt-0.5 text-sm text-text-muted">{subtitle}</p>
          </div>
          <Button onClick={onClose} aria-label="Fechar" variant="ghost" size="icon-sm" className="shrink-0">
            <X className="size-5" />
          </Button>
        </div>

        <div className="border-b border-border-subtle p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <Input
              type="text"
              placeholder="Buscar por modelo ou provedor..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex max-h-[60vh] min-h-0">
          <div className="w-56 shrink-0 overflow-y-auto border-r border-border-subtle p-2 custom-scrollbar">
            <button
              type="button"
              onClick={() => setSelectedProviderId(null)}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
                selectedProviderId === null ? "bg-primary text-primary-foreground" : "hover:bg-muted text-text-main",
              )}
            >
              <span>Todos os provedores</span>
              <span className={cn("text-xs", selectedProviderId === null ? "text-primary-foreground/80" : "text-text-muted")}>{totalCount}</span>
            </button>
            {sortedProviderIds.map((providerId) => (
              <button
                key={providerId}
                type="button"
                onClick={() => setSelectedProviderId(providerId)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  selectedProviderId === providerId ? "bg-primary text-primary-foreground" : "hover:bg-muted text-text-main",
                )}
              >
                <ProviderIcon providerId={providerId} alt={groups[providerId].name} size={18} fallbackText={providerId.slice(0, 2).toUpperCase()} />
                <span className="min-w-0 flex-1 truncate">{groups[providerId].name}</span>
                <span className={cn("shrink-0 text-xs", selectedProviderId === providerId ? "text-primary-foreground/80" : "text-text-muted")}>{groups[providerId].models.length}</span>
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
            {selectedProviderId ? (
              (flatModelsSorted || []).map((model) => renderModelRow(selectedProviderId, model))
            ) : (
              visibleGroups.map(([providerId, group]) => (
                <div key={providerId} className="mb-3">
                  <div className="sticky top-0 flex items-center gap-1.5 bg-surface px-3 py-1.5 text-xs font-medium text-text-muted">
                    <ProviderIcon providerId={providerId} alt={group.name} size={14} fallbackText={providerId.slice(0, 2).toUpperCase()} />
                    <span className="uppercase">{group.name}</span>
                    <span>· {group.models.length}</span>
                  </div>
                  {group.models.map((model) => renderModelRow(providerId, model))}
                </div>
              ))
            )}

            {(selectedProviderId ? (flatModelsSorted || []).length === 0 : visibleGroups.length === 0) && (
              <div className="flex flex-col items-center gap-2 py-10 text-text-muted">
                <SearchX className="size-5" />
                <p className="text-sm">Nenhum modelo encontrado</p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import Button from "@/shared/components/Button";
import ProviderIcon from "./ProviderIcon";
import CapacityBadges from "./CapacityBadges";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS, AI_PROVIDERS, isOpenAICompatibleProvider, isAnthropicCompatibleProvider, getProviderAlias } from "@/shared/constants/providers";
import { Check, Info, Layers, Pencil, Search, SearchX, X } from "lucide-react";

type RawModel = { id: string; name: string; [key: string]: unknown };

// Provider order: OAuth first, then Free Tier, then API Key (matches dashboard/providers)
const PROVIDER_ORDER = [
  ...Object.keys(OAUTH_PROVIDERS),
  ...Object.keys(FREE_PROVIDERS),
  ...Object.keys(FREE_TIER_PROVIDERS),
  ...Object.keys(APIKEY_PROVIDERS),
];

// Providers that need no auth Ã¢â‚¬â€ always show in model selector
const NO_AUTH_PROVIDER_IDS = Object.keys(FREE_PROVIDERS).filter(id => (FREE_PROVIDERS as Record<string, { noAuth?: boolean }>)[id].noAuth);

export interface ActiveProvider {
  provider: string;
  id?: string;
  name?: string;
  providerSpecificData?: Record<string, unknown>;
}

interface ModelItem {
  id: string;
  name: string;
  value: string;
  isPlaceholder?: boolean;
  isCustom?: boolean;
  kind?: string;
}

interface ModelGroup {
  name: string;
  alias: string;
  color: string;
  models: ModelItem[];
  isCustom?: boolean;
  hasModels?: boolean;
}

interface ModelSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (model: ModelItem | { value: string }) => void;
  onDeselect?: (model: ModelItem | { value: string }) => void;
  selectedModel?: string;
  activeProviders?: ActiveProvider[];
  title?: string;
  modelAliases?: Record<string, string>;
  kindFilter?: string | null;
  capFilter?: string | null;
  addedModelValues?: string[];
  closeOnSelect?: boolean;
}

export default function ModelSelectModal({
  isOpen,
  onClose,
  onSelect,
  onDeselect,
  selectedModel,
  activeProviders = [],
  title = "Selecionar Modelo",
  modelAliases = {},
  kindFilter = null,
  capFilter = null,
  addedModelValues = [],
  closeOnSelect = true,
}: ModelSelectModalProps) {
  // Filter activeProviders by serviceKinds when kindFilter set (e.g. "webSearch", "webFetch")
  const filteredActiveProviders = useMemo(() => {
    if (!kindFilter) return activeProviders;
    return activeProviders.filter((p) => {
      const info = AI_PROVIDERS[p.provider as keyof typeof AI_PROVIDERS] as Record<string, unknown> | undefined;
      const kinds = (info?.serviceKinds as string[]) || ["llm"];
      return kinds.includes(kindFilter);
    });
  }, [activeProviders, kindFilter]);
  const { getCaps } = useModelCaps();
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [combos, setCombos] = useState<{ id: string; name: string }[]>([]);
  const [providerNodes, setProviderNodes] = useState<{ id: string; name?: string; prefix?: string }[]>([]);
  const [customModels, setCustomModels] = useState<{ id: string; name?: string; providerAlias?: string }[]>([]);
  const [disabledModels, setDisabledModels] = useState<Record<string, string[]>>({});
  const [cursorModels, setCursorModels] = useState<{ id: string; name: string }[]>([]);

  // Cursor exposes the usable catalog per account. Keep the static catalog only
  // as a fallback, since it quickly becomes stale and different accounts can
  // have different model entitlements.
  const cursorConnectionIds = useMemo(
    () => activeProviders
      .filter((provider) => provider.provider === "cursor" && provider.id)
      .map((provider) => provider.id as string),
    [activeProviders],
  );

  useEffect(() => {
    if (!isOpen || cursorConnectionIds.length === 0) {
      setCursorModels([]);
      return undefined;
    }

    let cancelled = false;
    Promise.all(cursorConnectionIds.map(async (connectionId) => {
      const response = await fetch(`/api/providers/${connectionId}/models`, { cache: "no-store" });
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data.models) ? data.models : [];
    }))
      .then((modelLists) => {
        if (cancelled) return;
        const seen = new Set<string>();
        setCursorModels(modelLists.flat().filter((model: { id?: string }) => {
          if (!model?.id || seen.has(model.id)) return false;
          seen.add(model.id);
          return true;
        }));
      })
      .catch((error) => {
        // Do not hide the static fallback when the account catalog is unavailable.
        console.warn("Unable to load Cursor models for selector:", error);
        if (!cancelled) setCursorModels([]);
      });

    return () => { cancelled = true; };
  }, [isOpen, cursorConnectionIds]);

  const fetchCombos = async () => {
    try {
      const res = await fetch("/api/combos");
      if (!res.ok) throw new Error(`Failed to fetch combos: ${res.status}`);
      const data = await res.json();
      setCombos(data.combos || []);
    } catch (error) {
      console.error("Error fetching combos:", error);
      setCombos([]);
    }
  };

  useEffect(() => {
    if (isOpen) fetchCombos();
  }, [isOpen]);

  const fetchProviderNodes = async () => {
    try {
      const res = await fetch("/api/provider-nodes");
      if (!res.ok) throw new Error(`Failed to fetch provider nodes: ${res.status}`);
      const data = await res.json();
      setProviderNodes(data.nodes || []);
    } catch (error) {
      console.error("Error fetching provider nodes:", error);
      setProviderNodes([]);
    }
  };

  useEffect(() => {
    if (isOpen) fetchProviderNodes();
  }, [isOpen]);

  const fetchCustomModels = async () => {
    try {
      const res = await fetch("/api/models/custom");
      if (!res.ok) throw new Error(`Failed to fetch custom models: ${res.status}`);
      const data = await res.json();
      setCustomModels(data.models || []);
    } catch (error) {
      console.error("Error fetching custom models:", error);
      setCustomModels([]);
    }
  };

  useEffect(() => {
    if (isOpen) fetchCustomModels();
  }, [isOpen]);

  const fetchDisabledModels = async () => {
    try {
      const res = await fetch("/api/models/disabled");
      if (!res.ok) throw new Error(`Failed to fetch disabled models: ${res.status}`);
      const data = await res.json();
      setDisabledModels(data.disabled || {});
    } catch (error) {
      console.error("Error fetching disabled models:", error);
      setDisabledModels({});
    }
  };

  useEffect(() => {
    if (isOpen) fetchDisabledModels();
  }, [isOpen]);

  const allProviders = useMemo(() => ({ ...OAUTH_PROVIDERS, ...FREE_PROVIDERS, ...FREE_TIER_PROVIDERS, ...APIKEY_PROVIDERS }), []);

  // Group models by provider with priority order
  const groupedModels = useMemo(() => {
    const groups: Record<string, ModelGroup> = {};

    // Kinds where the provider IS the model (no per-model selection needed)
    const PROVIDER_AS_MODEL_KINDS = new Set(["webSearch", "webFetch"]);
    // Kinds that map directly to model.type field
    const TYPED_KINDS = new Set(["image", "tts", "stt", "embedding", "imageToText"]);
    // For these kinds, providers without hardcoded models can still be picked (provider-as-model fallback)
    const ALLOW_PROVIDER_FALLBACK_KINDS = new Set(["tts", "image", "webFetch"]);

    // Filter a models[] array by kindFilter (keep only matching kind)
    const filterByKind = (models: ModelItem[]) => {
      if (!kindFilter) return models.filter((m) => m.isPlaceholder || m.isCustom || !getModelKind(m as unknown as Record<string, unknown>) || getModelKind(m as unknown as Record<string, unknown>) === "llm");
      if (!TYPED_KINDS.has(kindFilter)) return models;
      return models.filter((m) => m.isPlaceholder || getModelKind(m as unknown as Record<string, unknown>) === kindFilter);
    };

    // Get all active provider IDs from connections (filtered by kindFilter if set)
    const activeConnectionIds = filteredActiveProviders.map(p => p.provider);

    // No-auth providers: filter by kindFilter as well
    const noAuthIds = kindFilter
      ? NO_AUTH_PROVIDER_IDS.filter((id) => {
          const info = AI_PROVIDERS[id as keyof typeof AI_PROVIDERS] as Record<string, unknown> | undefined;
          return ((info?.serviceKinds as string[]) || ["llm"]).includes(kindFilter);
        })
      : NO_AUTH_PROVIDER_IDS;

    // Only show connected providers (including both standard and custom)
    const providerIdsToShow = new Set([
      ...activeConnectionIds,
      ...noAuthIds,
    ]);

    // Sort by PROVIDER_ORDER
    const sortedProviderIds = [...providerIdsToShow].sort((a, b) => {
      const indexA = PROVIDER_ORDER.indexOf(a);
      const indexB = PROVIDER_ORDER.indexOf(b);
      return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
    });

    sortedProviderIds.forEach((providerId) => {
      const alias = getProviderAlias(providerId);
      const providerInfo = (allProviders as Record<string, Record<string, unknown>>)[providerId] || { name: providerId, color: "#666" };
      const isCustomProvider = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);

      // For provider-as-model kinds (webSearch/webFetch): emit a single entry where value === providerId
      if (kindFilter && PROVIDER_AS_MODEL_KINDS.has(kindFilter)) {
        groups[providerId] = {
          name: providerInfo.name as string,
          alias,
          color: providerInfo.color as string,
          models: [{ id: providerId, name: providerInfo.name as string, value: providerId }],
        };
        return;
      }

      if (providerInfo.passthroughModels) {
        const aliasModels = Object.entries(modelAliases)
          .filter(([, fullModel]) => fullModel.startsWith(`${alias}/`))
          .map(([aliasName, fullModel]) => ({
            id: fullModel.replace(`${alias}/`, ""),
            name: aliasName,
            value: fullModel,
          }));
        const customRegisteredModels = customModels
          .filter((m) => m.providerAlias === alias)
          .map((m) => ({
            id: m.id,
            name: m.name || m.id,
            value: `${alias}/${m.id}`,
            kind: getModelKind(m),
            isCustom: true,
          }));

        let combined = aliasModels;
        if (kindFilter && TYPED_KINDS.has(kindFilter)) {
          const registeredTyped = customRegisteredModels.filter((m) => getModelKind(m) === kindFilter);
          combined = [
            ...registeredTyped,
            ...(getModelsByProviderId(providerId) as RawModel[])
            .filter((m: RawModel) => getModelKind(m) === kindFilter)
            .filter((m: RawModel) => getModelKind(m) === kindFilter)
            .map((m: RawModel) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}`, kind: getModelKind(m) }))
            .filter((m: { value: string }) => !registeredTyped.some((registered) => registered.value === m.value)),
          ];
          if (combined.length === 0 && ALLOW_PROVIDER_FALLBACK_KINDS.has(kindFilter)) {
            const supports = ((providerInfo.serviceKinds as string[]) || ["llm"]).includes(kindFilter);
            if (supports) combined = [{ id: providerId, name: providerInfo.name as string, value: alias }];
          }
        } else {
          const registeredLlms = customRegisteredModels.filter((m) => !getModelKind(m) || getModelKind(m) === "llm");
          const seen = new Set([...aliasModels, ...registeredLlms].map((m) => m.value));
          const hardcoded = (getModelsByProviderId(providerId) as RawModel[])
            .filter((m: RawModel) => !getModelKind(m) || getModelKind(m) === "llm")
            .map((m: RawModel) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}`, kind: getModelKind(m) }))
            .filter((m: { value: string }) => !seen.has(m.value));
          combined = [...registeredLlms, ...aliasModels.filter((m) => !registeredLlms.some((registered) => registered.value === m.value)), ...hardcoded];
        }

        if (combined.length > 0) {
          const matchedNode = providerNodes.find(node => node.id === providerId);
          const displayName = matchedNode?.name || providerInfo.name as string;

          groups[providerId] = {
            name: displayName,
            alias: alias,
            color: providerInfo.color as string,
            models: combined,
          };
        }
      } else if (isCustomProvider) {
        if (kindFilter && TYPED_KINDS.has(kindFilter)) return;
        const connection = activeProviders.find(p => p.provider === providerId);
        const matchedNode = providerNodes.find(node => node.id === providerId);
        const displayName = matchedNode?.name || connection?.name || providerInfo.name as string;
        const nodePrefix = (connection?.providerSpecificData?.prefix as string) || matchedNode?.prefix || providerId;

        const nodeModels = Object.entries(modelAliases)
          .filter(([, fullModel]) => fullModel.startsWith(`${providerId}/`))
          .map(([aliasName, fullModel]) => ({
            id: fullModel.replace(`${providerId}/`, ""),
            name: aliasName,
            value: `${nodePrefix}/${fullModel.replace(`${providerId}/`, "")}`,
          }));

        const registeredCustom = customModels
          .filter((m) => m.providerAlias === providerId)
          .map((m) => ({
            id: m.id,
            name: m.name || m.id,
            value: `${nodePrefix}/${m.id}`,
            isCustom: true,
          }));
        const seen = new Set(nodeModels.map((m) => m.value));
        const mergedModels = [...nodeModels, ...registeredCustom.filter((m) => !seen.has(m.value))];

        const modelsToShow = mergedModels.length > 0 ? mergedModels : [{
          id: `__placeholder__${providerId}`,
          name: `${nodePrefix}/model-id`,
          value: `${nodePrefix}/model-id`,
          isPlaceholder: true,
        }];

        groups[providerId] = {
          name: displayName,
          alias: nodePrefix,
          color: providerInfo.color as string,
          models: modelsToShow,
          isCustom: true,
          hasModels: mergedModels.length > 0,
        };
      } else {
        const hardcodedModels: RawModel[] = providerId === "cursor" && cursorModels.length > 0
          ? cursorModels
          : (getModelsByProviderId(providerId) as RawModel[]);
        const hardcodedIds = new Set(hardcodedModels.map((m: RawModel) => m.id));

        const hasHardcoded = hardcodedModels.length > 0;
        const customAliasModels = Object.entries(modelAliases)
          .filter(([aliasName, fullModel]) =>
            fullModel.startsWith(`${alias}/`) &&
            (hasHardcoded ? aliasName === fullModel.replace(`${alias}/`, "") : true) &&
            !hardcodedIds.has(fullModel.replace(`${alias}/`, ""))
          )
          .map(([aliasName, fullModel]) => {
            const modelId = fullModel.replace(`${alias}/`, "");
            return { id: modelId, name: aliasName, value: fullModel, isCustom: true };
          });

        const customAliasIds = new Set(customAliasModels.map((m) => m.id));
        const customRegisteredModels = customModels
          .filter((m) => m.providerAlias === alias && !hardcodedIds.has(m.id) && !customAliasIds.has(m.id))
          .map((m) => ({ id: m.id, name: m.name || m.id, value: `${alias}/${m.id}`, isCustom: true }));

        const merged: ModelItem[] = [
          ...hardcodedModels.map((m: RawModel) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}`, kind: getModelKind(m) ?? undefined })),
          ...customAliasModels,
          ...customRegisteredModels,
        ];
        const seen = new Set<string>();
        let allModels = filterByKind(merged.filter((m) => {
          if (seen.has(m.value)) return false;
          seen.add(m.value);
          return true;
        }));

        if (allModels.length === 0 && kindFilter && ALLOW_PROVIDER_FALLBACK_KINDS.has(kindFilter)) {
          const supports = ((providerInfo.serviceKinds as string[]) || ["llm"]).includes(kindFilter);
          if (supports) {
            allModels = [{ id: providerId, name: providerInfo.name as string, value: alias }];
          }
        }

        if (allModels.length > 0) {
          groups[providerId] = {
            name: providerInfo.name as string,
            alias: alias,
            color: providerInfo.color as string,
            models: allModels,
          };
        }
      }
    });

    // Filter out disabled models per provider (disabled keyed by storage alias OR providerId)
    Object.entries(groups).forEach(([providerId, group]) => {
      const aliasKey = getProviderAlias(providerId);
      const disabledIds = new Set([
        ...(disabledModels[aliasKey] || []),
        ...(disabledModels[providerId] || []),
      ]);
      if (disabledIds.size === 0) return;
      group.models = group.models.filter((m) => !disabledIds.has(m.id));
      if (group.models.length === 0) delete groups[providerId];
    });

    return groups;
  }, [filteredActiveProviders, modelAliases, allProviders, providerNodes, customModels, disabledModels, kindFilter, activeProviders, cursorModels]);

  // Filter combos by search query (and hide combos when kindFilter is set Ã¢â‚¬â€ combos are LLM-only by design)
  const filteredCombos = useMemo(() => {
    if (kindFilter || capFilter) return [];
    if (!searchQuery.trim()) return combos;
    const query = searchQuery.toLowerCase();
    return combos.filter(c => c.name.toLowerCase().includes(query));
  }, [combos, searchQuery, kindFilter]);

  // Sort models alphabetically, with added models floated to top
  const sortModels = (models: ModelItem[]) => {
    const added = models.filter(m => addedModelValues.includes(m.value)).sort((a, b) => a.name.localeCompare(b.name));
    const rest = models.filter(m => !addedModelValues.includes(m.value)).sort((a, b) => a.name.localeCompare(b.name));
    return [...added, ...rest];
  };

  // Filter models by search query
  const filteredGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const filtered: Record<string, ModelGroup> = {};
    Object.entries(groupedModels).forEach(([providerId, group]) => {
      let models = group.models;
      if (capFilter) {
        models = models.filter((m) => (getCaps(m.value) as Record<string, boolean> | null)?.[capFilter] === true);
        if (models.length === 0) return;
      }
      if (query) {
        const providerNameMatches = group.name.toLowerCase().includes(query);
        models = models.filter(
          (m) =>
            m.name.toLowerCase().includes(query) ||
            m.id.toLowerCase().includes(query)
        );
        if (models.length === 0 && !providerNameMatches) return;
      }
      filtered[providerId] = {
        ...group,
        models: sortModels(models),
      };
    });

    return filtered;
  }, [groupedModels, searchQuery, addedModelValues]);

  const handleSelect = (model: ModelItem | { value?: string; name?: string }) => {
    const value = model?.value || model?.name || model;
    const isAdded = addedModelValues.includes(value as string);

    if (isAdded && onDeselect) {
      onDeselect(model as ModelItem);
    } else {
      onSelect(model as ModelItem);
    }

    if (closeOnSelect) {
      onClose();
      setSearchQuery("");
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) {
        onClose();
        setSearchQuery("");
      }
    }}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "bg-surface border border-border-subtle rounded-[14px]",
          "shadow-[var(--shadow-elev)] ring-0 gap-0 p-0",
          "max-w-md",
          "p-4!"
        )}
      >
        <div className="flex items-center justify-between p-2 border-b border-border-subtle">
          <DialogTitle className="text-lg font-semibold text-text-main ml-2">
            {title}
          </DialogTitle>
          <Button onClick={() => { onClose(); setSearchQuery(""); }} aria-label="Fechar" variant="ghost" size="icon-sm">
            <X className="size-5" />
          </Button>
        </div>
        <div className="p-6 max-h-[calc(85vh-100px)] overflow-y-auto custom-scrollbar">
      {/* Info bar */}
      <div className="flex items-center gap-2 mb-3 px-2.5 py-2 bg-primary/8 border border-primary/20 rounded-lg text-xs text-text-muted">
        <Info className="size-3.5 text-primary shrink-0" />
        <span>Clique para adicionar, clique novamente para remover. As alterações são salvas automaticamente.</span>
      </div>

      {/* Search - compact */}
      <div className="mb-3">
        <div className="relative">
          <Search className="size-4" />
          <Input
            type="text"
            placeholder="Pesquisar..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs"
          />
        </div>
      </div>

      {/* Models grouped by provider - compact */}
      <div className="max-h-[400px] overflow-y-auto space-y-3">
        {/* Combos section - always first */}
        {filteredCombos.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5 sticky top-0 bg-surface py-0.5">
              <Layers className="size-4" />
              <span className="text-xs font-medium text-primary">Combos</span>
              <span className="text-[10px] text-text-muted">({filteredCombos.length})</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {filteredCombos.map((combo) => {
                const isSelected = selectedModel === combo.name;
                return (
                  <Button
                    key={combo.id}
                    onClick={() => handleSelect({ id: combo.name, name: combo.name, value: combo.name })}
                    variant={isSelected || addedModelValues.includes(combo.name) ? "default" : "outline"}
                    size="sm"
                    className={`
                      px-2 py-1 rounded-xl text-xs font-medium hover:cursor-pointer flex items-center gap-1
                      ${isSelected
                        ? "bg-primary text-white border-primary"
                        : addedModelValues.includes(combo.name)
                          ? "bg-primary border-primary text-white hover:bg-primary-hover"
                          : ""
                      }
                    `}
                  >
                    {addedModelValues.includes(combo.name) && (
                      <Check className="size-2.5" />
                    )}
                    {combo.name}
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        {/* Provider models */}
        {Object.entries(filteredGroups).map(([providerId, group]) => (
          <div key={providerId}>
            {/* Provider header */}
            <div className="flex items-center gap-1.5 mb-1.5 sticky top-0 bg-surface py-0.5">
              <ProviderIcon
                src={`/providers/${providerId}.png`}
                alt={group.name}
                size={14}
                fallbackText={(group.name || providerId).slice(0, 2).toUpperCase()}
                fallbackColor={group.color}
              />
              <span className="text-xs font-medium text-primary">
                {group.name}
              </span>
              <span className="text-[10px] text-text-muted">
                ({group.models.length})
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {group.models.map((model) => {
                const isSelected = selectedModel === model.value;
                const isPlaceholder = model.isPlaceholder;
                return (
                  <Button
                    key={model.value}
                    onClick={() => handleSelect(model)}
                    title={isPlaceholder ? "Selecione para preencher, depois edite o ID do modelo no campo" : undefined}
                    variant={isPlaceholder ? "outline" : isSelected || addedModelValues.includes(model.value) ? "default" : "outline"}
                    size="sm"
                    className={`
                      px-2 py-1 rounded-xl text-xs font-medium hover:cursor-pointer
                      ${isPlaceholder
                        ? "border-dashed border-border text-text-muted hover:border-primary/50 hover:text-primary bg-surface italic"
                        : isSelected
                          ? "bg-primary text-white border-primary"
                          : addedModelValues.includes(model.value)
                            ? "bg-primary border-primary text-white hover:bg-primary-hover"
                            : ""
                      }
                    `}
                  >
                    <span className="flex items-center gap-1">
                      {addedModelValues.includes(model.value) && !isPlaceholder && (
                        <Check className="size-2.5" />
                      )}
                      {isPlaceholder ? (
                        <>
                          <Pencil className="size-3" />
                          {model.name}
                        </>
                      ) : model.isCustom ? (
                        <>
                          {model.name}
                          <span className="text-[9px] opacity-60 font-normal">personalizado</span>
                          <CapacityBadges caps={getCaps(model.value) as Record<string, boolean> | null} />
                        </>
                      ) : (
                        <>
                          {model.name}
                          <CapacityBadges caps={getCaps(model.value) as Record<string, boolean> | null} />
                        </>
                      )}
                    </span>
                  </Button>
                );
              })}
            </div>
          </div>
        ))}

        {Object.keys(filteredGroups).length === 0 && filteredCombos.length === 0 && (
          <div className="text-center py-4 text-text-muted">
            <SearchX className="size-4" />
            <p className="text-xs">Nenhum modelo encontrado</p>
          </div>
        )}
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

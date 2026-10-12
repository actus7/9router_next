"use client";

import { useId, useMemo, useState } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import { Copy, Database, GripVertical, Pencil, Plus, RefreshCw, RotateCcw, SlidersHorizontal, Sparkles, X } from "lucide-react";
import Card from "@/shared/components/Card";
import { Button } from "@/components/ui/button";
import ProviderIcon from "@/shared/components/ProviderIcon";
import TierModelPickerModal, { type ModelPriceInfo } from "@/shared/components/TierModelPickerModal";
import type { ActiveProvider } from "@/shared/components/ModelSelectModal";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";
import { ROUTING_TIERS, type LaneEntryConfig, type RoutingTier, type SmartModelProfile } from "@/shared/llm-catalog";
import ModelParamsDialog from "./ModelParamsDialog";
import { useModelParamInfo } from "./useModelParamInfo";
import type { SuggestionPreview } from "./smartComboHelpers";

const TIER_META: Record<RoutingTier, { label: string; scoreRange: string }> = {
  simple: { label: translate("Simple") || "Simple", scoreRange: translate("Short, direct questions") || "Short, direct questions" },
  standard: { label: translate("Standard") || "Standard", scoreRange: translate("Most everyday requests") || "Most everyday requests" },
  complex: { label: translate("Complex") || "Complex", scoreRange: translate("Multi-step tasks") || "Multi-step tasks" },
  reasoning: { label: translate("Reasoning") || "Reasoning", scoreRange: translate("Needs to think a lot before answering") || "Needs to think a lot before answering" },
};

function fmtPrice(n: number): string {
  return `$${n.toFixed(n < 1 ? 3 : 2)}`;
}

function modelSubtitle(profile: SmartModelProfile | undefined, providerName: string): string {
  if (profile && profile.inputPrice !== null && profile.outputPrice !== null) {
    return `${fmtPrice(profile.inputPrice)} ${translate("input") || "input"} · ${fmtPrice(profile.outputPrice)} ${translate("output") || "output"} / 1M`;
  }
  return `${providerName} · ${translate("price not catalogued") || "price not catalogued"}`;
}

interface RowProps {
  id: string;
  value: string;
  profile: SmartModelProfile | undefined;
  providerId: string;
  providerName: string;
  entry: LaneEntryConfig | null;
  onEntryChange: (entry: LaneEntryConfig | null) => void;
  onDuplicate: (connectionId: string) => void;
  onEdit: () => void;
  onRemove: () => void;
}

const NO_ENTRY: LaneEntryConfig = {};
function cleaned(entry: LaneEntryConfig): LaneEntryConfig | null {
  return entry.connectionId || (entry.params && Object.keys(entry.params).length > 0) ? entry : null;
}

function TierModelRow({ id: _id, value, profile, providerId, providerName, entry, onEntryChange, onDuplicate, onEdit, onRemove }: RowProps) {
  const info = useModelParamInfo(value);
  const [paramsOpen, setParamsOpen] = useState(false);
  const connections = info?.connections ?? [];
  const hasParams = Boolean(entry?.params && Object.keys(entry.params).length > 0);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id: _id });
  const style = {
    transform: CSS.Transform.toString(transform),
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 999 : undefined,
  };
  const displayName = profile?.displayName || value;
  const subtitle = modelSubtitle(profile, providerName);

  const paramChips = Object.entries(entry?.params ?? {}).map(([path, v]) => `${path}: ${String(v)}`);
  // Shown on hover or keyboard focus; always shown where there is no hover (touch).
  const onHover = "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative flex flex-col gap-1 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 transition-colors hover:bg-muted",
        isDragging && "shadow-md ring-1 ring-primary/30",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Button
          {...attributes}
          {...listeners}
          variant="ghost"
          size="icon-sm"
          type="button"
          className={cn("absolute top-2 left-0 size-5 cursor-grab touch-none active:cursor-grabbing", onHover)}
          title={translate("Drag to reorder") || "Drag to reorder"}
          aria-label={`${translate("Drag") || "Drag"} ${displayName}`}
        >
          <GripVertical className="size-3.5" />
        </Button>

        <ProviderIcon providerId={providerId} alt={providerName} size={16} fallbackText={providerId.slice(0, 2).toUpperCase()} className="shrink-0" />

        <p className="min-w-0 flex-1 truncate text-sm font-medium text-text-main" title={displayName}>{displayName}</p>

        {connections.length > 1 && (
          <select
            className="h-6 max-w-24 shrink-0 cursor-pointer rounded-full border border-border bg-surface px-2 text-xs text-text-main"
            value={entry?.connectionId ?? ""}
            title={translate("Account used for this entry") || "Account used for this entry"}
            aria-label={translate("Account used for this entry") || "Account used for this entry"}
            onChange={(e) => onEntryChange(cleaned({ ...(entry ?? NO_ENTRY), connectionId: e.target.value || undefined }))}
          >
            <option value="">{translate("Auto") || "Auto"}</option>
            {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.label}</option>)}
          </select>
        )}
        {info?.spec && (
          <Button variant="ghost" size="icon-xs" onClick={() => setParamsOpen(true)} className={cn("size-6 shrink-0", hasParams ? "text-primary" : "text-text-muted")} title={translate("Model parameters") || "Model parameters"} aria-label={`${translate("Model parameters") || "Model parameters"} ${displayName}`}>
            <SlidersHorizontal className="size-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon-xs" onClick={onRemove} className="size-6 shrink-0 text-text-muted hover:text-destructive" title={translate("Remove") || "Remove"} aria-label={`${translate("Remove") || "Remove"} ${displayName}`}>
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex min-w-0 items-center gap-1 pl-6">
        <p className="min-w-0 flex-1 truncate text-[11px] text-text-muted" title={subtitle}>{subtitle}</p>
        <Button variant="ghost" size="icon-xs" onClick={onEdit} className={cn("size-5 shrink-0", onHover)} title={translate("Change model") || "Change model"} aria-label={`${translate("Edit") || "Edit"} ${displayName}`}>
          <Pencil className="size-3" />
        </Button>
        {connections.length > 1 && (
          <Button variant="ghost" size="icon-xs" className={cn("size-5 shrink-0", onHover)} title={translate("Add the same model on another account") || "Add the same model on another account"}
            aria-label={translate("Add fallback") || "Add fallback"}
            onClick={() => onDuplicate(connections.find((c) => c.id !== entry?.connectionId)?.id ?? "")}>
            <Copy className="size-3" />
          </Button>
        )}
      </div>
      {paramChips.length > 0 && (
        <div className="flex min-w-0 flex-wrap gap-1 pl-6">
          {paramChips.map((chip) => (
            <span key={chip} className="max-w-full truncate rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary" title={chip}>{chip}</span>
          ))}
        </div>
      )}
      {paramsOpen && info?.spec && (
        <ModelParamsDialog
          modelName={displayName}
          params={info.spec.params}
          initial={entry?.params}
          onClose={() => setParamsOpen(false)}
          onSave={(params) => { onEntryChange(cleaned({ ...(entry ?? NO_ENTRY), params })); setParamsOpen(false); }}
        />
      )}
    </div>
  );
}

interface TierColumnProps {
  tier: RoutingTier;
  models: string[];
  entries: Array<LaneEntryConfig | null>;
  profileByKey: Map<string, SmartModelProfile>;
  activeProviders: ActiveProvider[];
  modelAliases: Record<string, string>;
  onChange: (models: string[], entries: Array<LaneEntryConfig | null>) => void;
}

function TierColumn({ tier, models, entries, profileByKey, activeProviders, modelAliases, onChange }: TierColumnProps) {
  const meta = TIER_META[tier];
  const [pickerMode, setPickerMode] = useState<{ index: number | null } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const priceByModel = useMemo(() => {
    const map: Record<string, ModelPriceInfo> = {};
    profileByKey.forEach((profile, key) => { map[key] = { inputPrice: profile.inputPrice, outputPrice: profile.outputPrice }; });
    return map;
  }, [profileByKey]);

  // Entries are index-aligned with models; pad so a lane with none configured lines up.
  const laneEntries = models.map((_, index) => entries[index] ?? null);
  const itemIds = models.map((model, index) => `${tier}:${index}:${model}`);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = itemIds.indexOf(String(active.id));
    const newIndex = itemIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    onChange(arrayMove(models, oldIndex, newIndex), arrayMove(laneEntries, oldIndex, newIndex));
  };

  // dnd-kit numbers its aria-describedby with a global counter that differs between SSR and hydration; a stable id fixes it.
  const dndId = useId();

  const handlePick = (value: string) => {
    if (pickerMode?.index === null || pickerMode?.index === undefined) {
      onChange([...models, value], [...laneEntries, null]);
    } else {
      const next = [...models];
      next[pickerMode.index] = value;
      // A different model has different parameters and may not live on that account.
      onChange(next, laneEntries.map((entry, i) => (i === pickerMode.index ? null : entry)));
    }
    setPickerMode(null);
  };

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-muted/20 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-text-main">{meta.label}</p>
          <p className="text-xs text-text-muted">{meta.scoreRange}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onChange([], [])} disabled={models.length === 0} className="text-xs text-text-muted">
          <RotateCcw data-icon="inline-start" className="size-3.5" /> {translate("Clear")}
        </Button>
      </div>

      <DndContext id={dndId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis, restrictToParentElement]}>
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-1">
            {models.map((model, index) => {
              const profile = profileByKey.get(model);
              const providerId = profile?.provider || model.split("/")[0];
              const providerName = profile?.provider || providerId;
              return (
                <TierModelRow
                  key={itemIds[index]}
                  id={itemIds[index]}
                  value={model}
                  profile={profile}
                  providerId={providerId}
                  providerName={providerName}
                  entry={laneEntries[index]}
                  onEntryChange={(entry) => onChange(models, laneEntries.map((cur, i) => (i === index ? entry : cur)))}
                  onDuplicate={(connectionId) => onChange(
                    [...models.slice(0, index + 1), model, ...models.slice(index + 1)],
                    [...laneEntries.slice(0, index + 1), { connectionId }, ...laneEntries.slice(index + 1)],
                  )}
                  onEdit={() => setPickerMode({ index })}
                  onRemove={() => onChange(models.filter((_, i) => i !== index), laneEntries.filter((_, i) => i !== index))}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      <Button variant="outline" size="sm" onClick={() => setPickerMode({ index: null })} className="mt-1 w-full">
        <Plus data-icon="inline-start" className="size-4" /> {translate("Add Model")}
      </Button>

      {pickerMode && (
        <TierModelPickerModal
          isOpen
          onClose={() => setPickerMode(null)}
          onSelect={handlePick}
          title={`${meta.label} — ${translate("choose model") || "choose model"}`}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          addedModelValues={models}
          priceByModel={priceByModel}
        />
      )}
    </div>
  );
}

export default function ComplexityRoutingBoard({
  overrides,
  entries,
  onOverridesChange,
  enabled,
  profiles,
  activeProviders,
  modelAliases,
  onSuggest,
  suggesting,
  aaMeta,
  onSyncAa,
  syncingAa,
}: {
  overrides: Partial<Record<RoutingTier, string[]>>;
  entries: Partial<Record<RoutingTier, Array<LaneEntryConfig | null>>>;
  onOverridesChange: (tier: RoutingTier, models: string[], entries: Array<LaneEntryConfig | null>) => void;
  enabled: boolean;
  profiles: SmartModelProfile[];
  activeProviders: ActiveProvider[];
  modelAliases: Record<string, string>;
  onSuggest: () => void;
  suggesting: boolean;
  /** AA snapshot provenance of the last suggestion round; null when AA is off or failed. */
  aaMeta?: SuggestionPreview["aaMeta"];
  /** Refetch the Artificial Analysis snapshot now, ignoring the daily TTL. */
  onSyncAa: () => void;
  syncingAa: boolean;
}) {
  const profileByKey = useMemo(() => new Map(profiles.map((profile) => [profile.modelKey, profile])), [profiles]);

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-text-main">{translate("Complexity-based routing")}</h2>
            <p className="mt-1 text-sm text-text-muted">{translate("Each request is assessed on the spot and sent to the right tier — no latency cost. Use \"Suggest models with AI\" to fill the 4 columns automatically, or add manually.")}</p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
            <Button variant="outline" size="sm" onClick={onSuggest} loading={suggesting} className="shrink-0">
              <Sparkles data-icon="inline-start" /> {translate("Suggest models with AI")}
            </Button>
            <p className="flex items-center gap-1 text-[10px] text-text-muted">
              <Database className="size-3" aria-hidden="true" />
              {aaMeta
                ? <span title={translate("Your models found in Artificial Analysis, out of the models in its table. A sync refreshes the table; the count only grows when AA adds a model you use.") || "Your models found in Artificial Analysis, out of the models in its table. A sync refreshes the table; the count only grows when AA adds a model you use."}>{aaMeta.matchedCount} {translate("of your models have AA data") || "of your models have AA data"} · {translate("AA table") || "AA table"}: {aaMeta.modelCount}</span>
                : <>{translate("AA sync") || "AA sync"}</>}
              <Button
                variant="ghost"
                size="sm"
                onClick={onSyncAa}
                loading={syncingAa}
                className="h-5 px-1.5 text-[10px]"
                title={translate("Refetch Artificial Analysis now. The free tier allows 100 requests per day.") || "Refetch Artificial Analysis now. The free tier allows 100 requests per day."}
              >
                <RefreshCw data-icon="inline-start" /> {translate("Sync now") || "Sync now"}
              </Button>
            </p>
          </div>
        </div>

        {!enabled && (
          <p className="rounded-lg border border-dashed border-warning/40 bg-warning/5 px-3 py-2 text-xs text-text-muted">
            {translate("Complexity inference is off, so every request routes as Standard — only that column is used.")}
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {ROUTING_TIERS.map((tier) => (
            <TierColumn
              key={tier}
              tier={tier}
              models={overrides[tier] || []}
              entries={entries[tier] || []}
              profileByKey={profileByKey}
              activeProviders={activeProviders}
              modelAliases={modelAliases}
              onChange={(models, laneEntries) => onOverridesChange(tier, models, laneEntries)}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}

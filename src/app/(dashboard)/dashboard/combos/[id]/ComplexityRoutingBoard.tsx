"use client";

import { useMemo, useState } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import { GripVertical, Pencil, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import { Card, Button } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import TierModelPickerModal, { type ModelPriceInfo } from "@/shared/components/TierModelPickerModal";
import type { ActiveProvider } from "@/shared/components/ModelSelectModal";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ROUTING_TIERS, type RoutingTier, type SmartModelProfile } from "@/shared/llm-catalog";

const TIER_META: Record<RoutingTier, { label: string; scoreRange: string }> = {
  simple: { label: "Simples", scoreRange: "score 0–15" },
  standard: { label: "Padrão", scoreRange: "score 16–40" },
  complex: { label: "Complexo", scoreRange: "score 41–65" },
  reasoning: { label: "Raciocínio", scoreRange: "score 66+" },
};

function fmtPrice(n: number): string {
  return `$${n.toFixed(n < 1 ? 3 : 2)}`;
}

function modelSubtitle(profile: SmartModelProfile | undefined, providerName: string): string {
  if (profile && profile.inputPrice !== null && profile.outputPrice !== null) {
    return `${fmtPrice(profile.inputPrice)} entrada · ${fmtPrice(profile.outputPrice)} saída / 1M`;
  }
  return `${providerName} · preço não catalogado`;
}

interface RowProps {
  id: string;
  index: number;
  value: string;
  profile: SmartModelProfile | undefined;
  providerId: string;
  providerName: string;
  onMoveUp: () => void;
  onEdit: () => void;
  onRemove: () => void;
}

function TierModelRow({ id: _id, index, value, profile, providerId, providerName, onMoveUp, onEdit, onRemove }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id: _id });
  const style = {
    transform: CSS.Transform.toString(transform),
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 999 : undefined,
  };
  const displayName = profile?.displayName || value;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-2 transition-colors hover:bg-muted",
        isDragging && "shadow-md ring-1 ring-primary/30",
      )}
    >
      <Button
        {...attributes}
        {...listeners}
        variant="ghost"
        size="icon-sm"
        type="button"
        className="size-7 shrink-0 cursor-grab touch-none active:cursor-grabbing"
        title="Arrastar para reordenar"
        aria-label={`Arrastar ${displayName}`}
      >
        <GripVertical />
      </Button>

      <span className="w-6 shrink-0 rounded-full bg-surface px-1.5 py-0.5 text-center text-[11px] font-medium text-text-muted">{index + 1}º</span>

      <ProviderIcon providerId={providerId} alt={providerName} size={20} fallbackText={providerId.slice(0, 2).toUpperCase()} className="shrink-0" />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text-main">{displayName}</p>
        <p className="truncate text-xs text-text-muted">{modelSubtitle(profile, providerName)}</p>
      </div>

      {index > 0 && (
        <Button variant="ghost" size="icon-xs" onClick={onMoveUp} className="size-7 shrink-0" title="Mover para cima" aria-label={`Mover ${displayName} para cima`}>
          <GripVertical className="rotate-90" />
        </Button>
      )}
      <Button variant="ghost" size="icon-xs" onClick={onEdit} className="size-7 shrink-0" title="Trocar modelo" aria-label={`Editar ${displayName}`}>
        <Pencil />
      </Button>
      <Button variant="ghost" size="icon-xs" onClick={onRemove} className="size-7 shrink-0 text-destructive" title="Remover" aria-label={`Remover ${displayName}`}>
        <X />
      </Button>
    </div>
  );
}

interface TierColumnProps {
  tier: RoutingTier;
  models: string[];
  profileByKey: Map<string, SmartModelProfile>;
  activeProviders: ActiveProvider[];
  modelAliases: Record<string, string>;
  onChange: (models: string[]) => void;
}

function TierColumn({ tier, models, profileByKey, activeProviders, modelAliases, onChange }: TierColumnProps) {
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

  const itemIds = models.map((model, index) => `${tier}:${index}:${model}`);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = itemIds.indexOf(String(active.id));
    const newIndex = itemIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    onChange(arrayMove(models, oldIndex, newIndex));
  };

  const handlePick = (value: string) => {
    if (pickerMode?.index === null || pickerMode?.index === undefined) {
      onChange([...models, value]);
    } else {
      const next = [...models];
      next[pickerMode.index] = value;
      onChange(next);
    }
    setPickerMode(null);
  };

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-text-main">{meta.label}</p>
          <p className="text-xs text-text-muted">{meta.scoreRange}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onChange([])} disabled={models.length === 0} className="text-xs text-text-muted">
          <RotateCcw data-icon="inline-start" className="size-3.5" /> Limpar
        </Button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis, restrictToParentElement]}>
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-1.5">
            {models.map((model, index) => {
              const profile = profileByKey.get(model);
              const providerId = profile?.provider || model.split("/")[0];
              const providerName = profile?.provider || providerId;
              return (
                <TierModelRow
                  key={itemIds[index]}
                  id={itemIds[index]}
                  index={index}
                  value={model}
                  profile={profile}
                  providerId={providerId}
                  providerName={providerName}
                  onMoveUp={() => onChange(arrayMove(models, index, index - 1))}
                  onEdit={() => setPickerMode({ index })}
                  onRemove={() => onChange(models.filter((_, i) => i !== index))}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      <Button variant="outline" size="sm" onClick={() => setPickerMode({ index: null })} className="mt-1 w-full">
        <Plus data-icon="inline-start" className="size-4" /> Adicionar fallback
      </Button>

      {pickerMode && (
        <TierModelPickerModal
          isOpen
          onClose={() => setPickerMode(null)}
          onSelect={handlePick}
          title={`${meta.label} — escolher modelo`}
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
  onOverridesChange,
  enabled,
  onEnabledChange,
  profiles,
  activeProviders,
  modelAliases,
  onSuggest,
  suggesting,
}: {
  overrides: Partial<Record<RoutingTier, string[]>>;
  onOverridesChange: (tier: RoutingTier, models: string[]) => void;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  profiles: SmartModelProfile[];
  activeProviders: ActiveProvider[];
  modelAliases: Record<string, string>;
  onSuggest: () => void;
  suggesting: boolean;
}) {
  const profileByKey = useMemo(() => new Map(profiles.map((profile) => [profile.modelKey, profile])), [profiles]);

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-text-main">Roteamento padrão</h2>
            <p className="mt-1 text-sm text-text-muted">Analisa a complexidade de cada requisição na hora e envia para o nível correspondente (&lt;2ms, sem chamada externa).</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Button variant="outline" size="sm" onClick={onSuggest} loading={suggesting}>
              <Sparkles data-icon="inline-start" /> Sugerir modelos
            </Button>
            <label className="flex items-center gap-2 text-sm text-text-main">
              Rotear por complexidade
              <Switch aria-label="Rotear por complexidade" checked={enabled} onCheckedChange={onEnabledChange} />
            </label>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-4">
          {ROUTING_TIERS.map((tier) => (
            <TierColumn
              key={tier}
              tier={tier}
              models={overrides[tier] || []}
              profileByKey={profileByKey}
              activeProviders={activeProviders}
              modelAliases={modelAliases}
              onChange={(models) => onOverridesChange(tier, models)}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}

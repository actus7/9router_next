"use client";

import { useState } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import { Card, Button, Modal, Input, ModelSelectModal, ConfirmModal, CapacityBadges, Select } from "@/shared/components";
import { Switch } from "@/components/ui/switch";
import { Input as RawInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buttonVariants } from "@/components/ui/button";
import type { ActiveProvider } from "@/shared/components/ModelSelectModal";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import type { Combo, Connection, Settings } from "@/lib/data-access";
import { useNotificationStore } from "@/store/notificationStore";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";
import Link from "next/link";
import { AudioLines, ArrowDown, ArrowUp, BrainCircuit, Check, Copy, Eye, Gavel, GripVertical, Layers, Pencil, Plus, Trash2, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

interface CapEntry {
  enabled: boolean;
  roundRobin: boolean;
  models: string[];
}

interface Strategy {
  fallbackStrategy?: string;
  judgeModel?: string;
}

interface ConfirmState {
  title: string;
  message: string;
  onConfirm: () => Promise<void>;
}

interface CombosClientProps {
  initialCombos: Combo[];
  initialProviders: Connection[];
  initialSettings: Settings;
  initialAliases: Record<string, string>;
}

type ComboView = Omit<Combo, "models"> & { models: string[] };
type ModelCapsGetter = ReturnType<typeof useModelCaps>["getCaps"];

interface CapacityAdapterDefinition {
  key: string;
  label: string;
  icon: LucideIcon;
  desc: string;
}

function normalizeCombos(raw: Combo[] | undefined): ComboView[] {
  return (raw || [])
    .filter((combo) => !combo.kind || combo.kind === "llm" || combo.kind === "smart")
    .map((combo) => ({
      ...combo,
      models: Array.isArray(combo.models)
        ? combo.models.filter((model): model is string => typeof model === "string")
        : [],
    }));
}

// Capacity adapter: global fallback pools of models per input-modality capability.
const CAPACITY_ADAPTER_CAPS: CapacityAdapterDefinition[] = [
  { key: "vision", label: "Vision", icon: Eye, desc: "Images" },
  { key: "audioInput", label: "Audio", icon: AudioLines, desc: "Audio input" },
];
const EMPTY_CAP_ENTRY: CapEntry = { enabled: true, roundRobin: false, models: [] };
// Backward-compat: legacy stored form was an array of {model, enabled}.
function normalizeCapEntry(entry: unknown): CapEntry {
  if (Array.isArray(entry)) {
    return { enabled: true, roundRobin: false, models: entry.map((e) => (e as Record<string, unknown>)?.model || e).filter(Boolean) as string[] };
  }
  if (entry && typeof entry === "object") {
    const obj = entry as Record<string, unknown>;
    return {
      enabled: obj.enabled !== false,
      roundRobin: !!obj.roundRobin,
      models: Array.isArray(obj.models) ? (obj.models as unknown[]).filter(Boolean) as string[] : [],
    };
  }
  return { ...EMPTY_CAP_ENTRY };
}

function normalizeCapacityAdapter(raw: Record<string, unknown> | undefined): Record<string, CapEntry> {
  const rawAdapter = raw || {};
  const normalized: Record<string, CapEntry> = {};
  for (const cap of CAPACITY_ADAPTER_CAPS) {
    normalized[cap.key] = normalizeCapEntry(rawAdapter[cap.key]);
  }
  return normalized;
}

export default function CombosClient({ initialCombos, initialProviders, initialSettings, initialAliases }: CombosClientProps) {
  const notify = useNotificationStore();
  // Only LLM combos here - webSearch/webFetch combos belong to media-providers/web
  const [combos, setCombos] = useState<ComboView[]>(() => normalizeCombos(initialCombos));
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCombo, setEditingCombo] = useState<ComboView | null>(null);
  const activeProviders = initialProviders;
  const [comboStrategies, setComboStrategies] = useState<Record<string, Strategy>>((initialSettings.comboStrategies || {}) as Record<string, Strategy>);
  const [capacityAdapter, setCapacityAdapter] = useState<Record<string, CapEntry>>(
    normalizeCapacityAdapter(initialSettings.capacityAdapter as Record<string, unknown> | undefined)
  );
  const { getCaps } = useModelCaps();
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const { copied, copy } = useCopyToClipboard();

  const handleSetCapacityAdapter = async (next: Record<string, CapEntry>) => {
    const previous = capacityAdapter;
    setCapacityAdapter(next);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capacityAdapter: next }),
      });
      if (!response.ok) throw new Error(`settings ${response.status}`);
    } catch (error) {
      setCapacityAdapter(previous);
      notify.error("Failed to save adapter settings");
      console.error("Error updating capacity adapter:", error);
    }
  };

  const handleCreate = async (data: { name: string; models: string[]; kind?: string | null }) => {
    try {
      const res = await fetch("/api/combos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        // Re-fetch combos after create
        const combosRes = await fetch("/api/combos");
        if (combosRes.ok) {
          const combosData = await combosRes.json();
          setCombos(normalizeCombos(combosData.combos));
        }
        setShowCreateModal(false);
      } else {
        const err = await res.json();
        notify.error(err.error || "Failed to create combo");
      }
    } catch (error) {
      console.error("Error creating combo:", error);
    }
  };

  const handleUpdate = async (id: string, data: { name: string; models: string[] }) => {
    try {
      const res = await fetch(`/api/combos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        // Re-fetch combos after update
        const combosRes = await fetch("/api/combos");
        if (combosRes.ok) {
          const combosData = await combosRes.json();
          setCombos(normalizeCombos(combosData.combos));
        }
        setEditingCombo(null);
      } else {
        const err = await res.json();
        notify.error(err.error || "Failed to update combo");
      }
    } catch (error) {
      console.error("Error updating combo:", error);
    }
  };

  const handleDelete = async (id: string) => {
    setConfirmState({
      title: translate("Delete Combo") || "Delete Combo",
      message: translate("Delete this combo?") || "Delete this combo?",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/combos/${id}`, { method: "DELETE" });
          if (res.ok) {
            setCombos((currentCombos) => currentCombos.filter((combo) => combo.id !== id));
          } else {
            notify.error(translate("Failed to delete combo") || "Failed to delete combo");
          }
        } catch (error) {
          console.error("Error deleting combo:", error);
        }
      }
    });
  };

  // Merge a per-combo strategy patch into settings.comboStrategies.
  const handleSetComboStrategy = async (comboName: string, patch: Partial<Strategy>) => {
    const previous = comboStrategies;
    const updated = { ...comboStrategies };
    const next = { ...(updated[comboName] || {}), ...patch };
    const usesDefaultStrategy = !next.fallbackStrategy || next.fallbackStrategy === "fallback";
    if (usesDefaultStrategy && !next.judgeModel) {
      delete updated[comboName];
    } else {
      updated[comboName] = next;
    }

    setComboStrategies(updated);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comboStrategies: updated }),
      });
      if (!response.ok) throw new Error(`settings ${response.status}`);
    } catch (error) {
      setComboStrategies(previous);
      notify.error("Failed to save combo strategy");
      console.error("Error updating combo strategy:", error);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Header */}
      <section aria-labelledby="combo-strategies" className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p id="combo-strategies" className="mt-1 text-sm text-text-muted">
            {translate("Group models under a name and choose a strategy per combo:")}
          </p>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm text-text-muted lg:grid-cols-3">
            <div>
              <dt className="font-medium text-text-main">Fallback</dt>
              <dd>{translate("Tries models in order and moves to the next after a failure.")}</dd>
            </div>
            <div>
              <dt className="font-medium text-text-main">Round Robin</dt>
              <dd>{translate("Rotates models between requests to distribute load.")}</dd>
            </div>
            <div>
              <dt className="font-medium text-text-main">Fusion</dt>
              <dd>{translate("Runs the panel in parallel and lets a judge synthesize the response (N+1 calls).")}</dd>
            </div>
          </dl>
        </div>
        <Button size="lg" onClick={() => setShowCreateModal(true)} className="min-h-11 w-full whitespace-nowrap sm:w-auto">
          <Plus data-icon="inline-start" />
          {translate("Create Combo") || "Create Combo"}
        </Button>
      </section>

      {/* Combos List */}
      {combos.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
              <Layers className="size-8" />
            </div>
            <p className="text-text-main font-medium mb-1">{translate("No combos yet") || "No combos yet"}</p>
            <p className="text-sm text-text-muted mb-4">{translate("Create model combos with fallback support") || "Create model combos with fallback support"}</p>
            <Button icon={<Plus className="size-4" />} onClick={() => setShowCreateModal(true)} className="w-full sm:w-auto">
              {translate("Create Combo") || "Create Combo"}
            </Button>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {combos.map((combo) => (
            <ComboCard
              key={combo.id}
              combo={combo}
              getCaps={getCaps}
              activeProviders={activeProviders}
              copied={copied}
              onCopy={copy}
              onEdit={() => setEditingCombo(combo)}
              onDelete={() => handleDelete(combo.id)}
              strategy={comboStrategies[combo.name] || {}}
              onSetStrategy={(patch) => handleSetComboStrategy(combo.name, patch)}
            />
          ))}
        </div>
      )}

      {/* Capacity Adapter */}
      <CapacityAdapterSection
        capacityAdapter={capacityAdapter}
        onChange={handleSetCapacityAdapter}
        activeProviders={activeProviders}
        getCaps={getCaps}
      />

      {/* Create Modal */}
      {showCreateModal && (
        <ComboFormModal
          key="create"
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSave={handleCreate}
          activeProviders={activeProviders}
          modelAliases={initialAliases}
        />
      )}

      {editingCombo && (
        <ComboFormModal
          key={editingCombo.id}
          isOpen={!!editingCombo}
          combo={editingCombo}
          onClose={() => setEditingCombo(null)}
          onSave={(data) => handleUpdate(editingCombo.id, data)}
          activeProviders={activeProviders}
          modelAliases={initialAliases}
        />
      )}

      {/* Confirm Delete Modal */}
      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={() => { void confirmState?.onConfirm(); }}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        variant="danger"
      />
    </div>
  );
}

const STRATEGY_OPTIONS = [
  { value: "fallback", label: translate("Fallback — try in order") || "Fallback — try in order" },
  { value: "round-robin", label: translate("Round Robin — rotate") || "Round Robin — rotate" },
  { value: "fusion", label: translate("Fusion — panel + judge") || "Fusion — panel + judge" },
];

function ComboCard({ combo, getCaps, activeProviders = [], copied, onCopy, onEdit, onDelete, strategy = {}, onSetStrategy }: {
  combo: ComboView;
  getCaps: ModelCapsGetter;
  activeProviders?: Connection[];
  copied: string | null;
  onCopy: (value: string, id: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  strategy?: Strategy;
  onSetStrategy: (patch: Partial<Strategy>) => void;
}) {
  const [showJudgeSelect, setShowJudgeSelect] = useState(false);
  const current = strategy.fallbackStrategy || "fallback";
  const judge = strategy.judgeModel || "";
  const isFusion = current === "fusion";
  const isSmart = combo.kind === "smart";

  return (
    <Card padding="sm" className="group">
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Layers aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <code className="block truncate font-mono text-sm font-medium">{combo.name}</code>
              {isSmart && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">Smart</span>}
            </div>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
              {isSmart && combo.models.length === 0 ? (
                <span className="text-xs text-text-muted">{translate("Active inventory dynamically ranked")}</span>
              ) : combo.models.length === 0 ? (
                <span className="text-xs text-text-muted italic">{translate("No models")}</span>
              ) : (
                combo.models.slice(0, 3).map((model) => (
                  <code key={model} className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-1 font-mono text-xs text-text-muted">
                    <span className="truncate">{model}</span>
                    <CapacityBadges caps={getCaps?.(model)} />
                  </code>
                ))
              )}
              {combo.models.length > 3 && (
                <span className="text-xs text-text-muted">+{combo.models.length - 3} {translate("more") || "more"}</span>
              )}
            </div>
            {/* Fusion: judge picker (Auto = first model) */}
            {isFusion && (
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-text-muted">{translate("Judge") || "Judge"}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowJudgeSelect(true)}
                  className="min-h-9 max-w-full border-dashed font-mono"
                  title="Pick the model that fuses panel answers"
                >
                  <Gavel data-icon="inline-start" />
                  <span className="truncate">{judge || `Auto — ${combo.models[0] || (translate("first model") || "first model")}`}</span>
                </Button>
                {judge && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onSetStrategy({ judgeModel: "" })}
                    className="text-destructive"
                    title="Reset judge to Auto"
                    aria-label="Reset judge to Auto"
                  >
                    <X />
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="grid w-full gap-3 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)] lg:w-auto lg:grid-cols-[220px_auto] lg:items-end">
          {isSmart ? (
            <div className="flex min-h-10 items-center rounded-lg bg-muted px-3 text-xs text-text-muted">
              {translate("Complexity + task + capabilities")}
            </div>
          ) : (
            <div className="min-w-0">
              <span className="mb-1.5 block text-xs font-medium text-text-muted">{translate("Strategy")}</span>
              <Select
                options={STRATEGY_OPTIONS}
                value={current}
                onChange={(value) => onSetStrategy({ fallbackStrategy: value })}
                ariaLabel={`Strategy for ${combo.name}`}
              />
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => { e.stopPropagation(); onCopy(combo.name, `combo-${combo.id}`); }}
              className="min-h-11 sm:min-h-10"
              title="Copy combo name"
              aria-label="Copy combo name"
            >
              {copied === `combo-${combo.id}` ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
              <span>{copied === `combo-${combo.id}` ? (translate("Copied") || "Copied") : (translate("Copy") || "Copy")}</span>
            </Button>
            {isSmart ? (
              <Link
                href={`/dashboard/combos/${combo.id}`}
                aria-label={`Configurar ${combo.name}`}
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 sm:min-h-10")}
              >
                <BrainCircuit data-icon="inline-start" />
                <span>{translate("Configure") || "Configure"}</span>
              </Link>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={onEdit}
                className="min-h-11 sm:min-h-10"
                title="Edit"
                aria-label={`Edit ${combo.name}`}
              >
                <Pencil data-icon="inline-start" />
                <span>{translate("Edit") || "Edit"}</span>
              </Button>
            )}
            <Button
              variant="destructive"
              size="sm"
              onClick={onDelete}
              className="min-h-11 sm:min-h-10"
              title={translate("Delete") || "Delete"}
              aria-label={`Delete ${combo.name}`}
            >
              <Trash2 data-icon="inline-start" />
              <span>{translate("Delete")}</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Judge model picker */}
      {showJudgeSelect && (
        <ModelSelectModal
          isOpen={showJudgeSelect}
          onClose={() => setShowJudgeSelect(false)}
          onSelect={(m: { value: string }) => { onSetStrategy({ judgeModel: m?.value || "" }); setShowJudgeSelect(false); }}
          activeProviders={activeProviders as unknown as ActiveProvider[]}
          title="Select Judge Model"
          addedModelValues={judge ? [judge] : []}
          closeOnSelect={true}
        />
      )}
    </Card>
  );
}

function CapacityAdapterSection({ capacityAdapter, onChange, activeProviders, getCaps }: {
  capacityAdapter: Record<string, CapEntry>;
  onChange: (next: Record<string, CapEntry>) => void;
  activeProviders: Connection[];
  getCaps: ModelCapsGetter;
}) {
  return (
    <section aria-labelledby="capacity-adapters-heading" className="flex flex-col gap-3">
      <div className="min-w-0">
        <h2 id="capacity-adapters-heading" className="text-base font-semibold text-text-main">{translate("Vision & Audio")}</h2>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">
          {translate("Redirect unsupported image or audio inputs to a compatible fallback model.")}
        </p>
      </div>
      <div className="flex flex-col gap-4">
        {CAPACITY_ADAPTER_CAPS.map((cap) => (
          <CapacityAdapterCap
            key={cap.key}
            cap={cap}
            entry={capacityAdapter[cap.key] || EMPTY_CAP_ENTRY}
            onChange={(entry) => onChange({ ...capacityAdapter, [cap.key]: entry })}
            activeProviders={activeProviders}
            getCaps={getCaps}
          />
        ))}
      </div>
    </section>
  );
}

function CapacityAdapterCap({ cap, entry, onChange, activeProviders, getCaps }: {
  cap: CapacityAdapterDefinition;
  entry: CapEntry;
  onChange: (entry: CapEntry) => void;
  activeProviders: Connection[];
  getCaps: ModelCapsGetter;
}) {
  const [showModelSelect, setShowModelSelect] = useState(false);
  const { enabled, roundRobin, models } = entry;

  const patch = (p: Partial<CapEntry>) => onChange({ ...entry, ...p });

  const handleAdd = (model: { value: string }) => {
    if (models.includes(model.value)) return;
    patch({ models: [...models, model.value] });
  };

  const handleRemove = (index: number) => {
    const next = models.filter((_, i) => i !== index);
    patch({ models: next });
  };

  const handleDeselect = (model: { value: string }) => {
    patch({ models: models.filter((value) => value !== model.value) });
  };

  const handleMove = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= models.length) return;
    const next = [...models];
    [next[index], next[target]] = [next[target], next[index]];
    patch({ models: next });
  };

  const Icon = cap.icon;

  return (
    <Card padding="sm" className={cn("group", !enabled && "bg-surface/70")}>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-medium text-text-main">{cap.label}</h3>
              <p className="mt-0.5 text-xs text-text-muted">{cap.desc}</p>
            </div>
          </div>

          <div className="grid w-full grid-cols-2 gap-2 lg:w-auto lg:grid-cols-[auto_auto_auto]">
            <Label className="flex min-h-11 cursor-pointer select-none items-center justify-between gap-3 rounded-lg bg-muted px-3 text-xs text-text-muted">
              <span>{translate("Enabled") || "Enabled"}</span>
              <Switch
                checked={enabled}
                onCheckedChange={(value: boolean) => patch({ enabled: value })}
                aria-label={`Enable ${cap.label} adapter`}
              />
            </Label>
            <Label className="flex min-h-11 cursor-pointer select-none items-center justify-between gap-3 rounded-lg bg-muted px-3 text-xs text-text-muted">
              <span>Round Robin</span>
              <Switch
                checked={roundRobin}
                onCheckedChange={(value: boolean) => patch({ roundRobin: value })}
                disabled={!enabled}
                aria-label={`Round-robin ${cap.label} adapter`}
              />
            </Label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowModelSelect(true)}
              disabled={!enabled}
              title={`Add ${cap.label} model`}
              className="col-span-2 min-h-11 lg:col-span-1"
            >
              <Plus data-icon="inline-start" />
              {translate("Add Model") || "Add Model"}
            </Button>
          </div>
        </div>

        {models.length === 0 ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm text-text-muted">{translate("No models selected") || "No models selected"}</p>
        ) : (
          <ul aria-label={`${cap.label} fallback models`} className="grid min-w-0 gap-2 xl:grid-cols-2">
            {models.map((model, index) => (
              <li key={`${model}-${index}`} className="flex min-w-0 items-center gap-2 rounded-lg bg-muted px-2 py-1.5">
                <span className="w-5 shrink-0 text-center text-xs font-medium text-text-muted">{index + 1}</span>
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-text-main" title={model}>{model}</code>
                <CapacityBadges caps={getCaps?.(model)} />
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleMove(index, -1)}
                    disabled={index === 0}
                    className="size-9 sm:size-7"
                    title="Move up"
                    aria-label={`Move ${model} up`}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleMove(index, 1)}
                    disabled={index === models.length - 1}
                    className="size-9 sm:size-7"
                    title="Move down"
                    aria-label={`Move ${model} down`}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleRemove(index)}
                    className="size-9 text-destructive sm:size-7"
                    title="Remove"
                    aria-label={`Remove ${model}`}
                  >
                    <X />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showModelSelect && (
        <ModelSelectModal
          isOpen={showModelSelect}
          onClose={() => setShowModelSelect(false)}
          onSelect={handleAdd}
          onDeselect={handleDeselect}
          activeProviders={activeProviders as unknown as ActiveProvider[]}
          title={`Add ${cap.label} Model`}
          addedModelValues={models}
          capFilter={cap.key}
          closeOnSelect={false}
        />
      )}
    </Card>
  );
}

function ModelItem({ id, index, model, isFirst, isLast, onEdit, onMoveUp, onMoveDown, onRemove }: {
  id: string;
  index: number;
  model: string;
  isFirst: boolean;
  isLast: boolean;
  onEdit: (newVal: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 999 : undefined,
  };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(model);
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== model) onEdit(trimmed);
    else setDraft(model);
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") { setDraft(model); setEditing(false); }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex min-w-0 items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 transition-colors hover:bg-muted",
        isDragging && "shadow-md ring-1 ring-primary/30",
      )}
    >
      {/* Drag handle */}
      <Button
        {...attributes}
        {...listeners}
        variant="ghost"
        size="icon-sm"
        type="button"
        className="size-9 cursor-grab touch-none active:cursor-grabbing sm:size-7"
        title="Drag to reorder"
        aria-label={`Drag ${model} to reorder`}
      >
        <GripVertical />
      </Button>

      {/* Index badge */}
      <span className="w-4 shrink-0 text-center text-xs font-medium text-text-muted">{index + 1}</span>

      {/* Inline editable model value */}
      {editing ? (
        <RawInput
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1 px-1.5 py-0.5 font-mono text-xs text-text-main"
          aria-label={`Model ${index + 1}`}
        />
      ) : (
        <button
          type="button"
          className="min-w-0 flex-1 cursor-text truncate rounded px-1.5 py-0.5 text-left font-mono text-xs text-text-main hover:bg-surface-2/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setEditing(true)}
          title="Click to edit"
          aria-label={`Edit ${model}`}
        >
          {model}
        </button>
      )}

      {/* Priority arrows */}
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onMoveUp}
          disabled={isFirst}
          className="size-9 sm:size-6"
          title="Move up"
          aria-label={`Move ${model} up`}
        >
          <ArrowUp />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onMoveDown}
          disabled={isLast}
          className="size-9 sm:size-6"
          title="Move down"
          aria-label={`Move ${model} down`}
        >
          <ArrowDown />
        </Button>
      </div>

      {/* Remove */}
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onRemove}
        className="size-9 text-destructive sm:size-6"
        title="Remove"
        aria-label={`Remove ${model}`}
      >
        <X />
      </Button>
    </div>
  );
}

function ComboFormModal({ isOpen, combo, onClose, onSave, activeProviders, modelAliases, kindFilter = null }: {
  isOpen: boolean;
  combo?: ComboView;
  onClose: () => void;
  onSave: (data: { name: string; models: string[]; kind?: string | null }) => Promise<void>;
  activeProviders: Connection[];
  modelAliases: Record<string, string>;
  kindFilter?: string | null;
}) {
  // Initialize state with combo values - key prop on parent handles reset on remount
  const [name, setName] = useState(combo?.name || "");
  const [models, setModels] = useState<string[]>(combo?.models || []);
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [comboType, setComboType] = useState<"llm" | "smart">(combo?.kind === "smart" ? "smart" : "llm");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Use stable index-based IDs so duplicates and similar names are handled correctly
  const modelItems = models.map((model, i) => ({ uid: `item-${i}`, model }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = modelItems.findIndex((m) => m.uid === active.id);
      const newIndex = modelItems.findIndex((m) => m.uid === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        setModels((prev) => arrayMove(prev, oldIndex, newIndex));
      }
    }
  };

  const validateName = (value: string) => {
    if (!value.trim()) {
      setNameError(translate("Name is required") || "Name is required");
      return false;
    }
    if (!VALID_NAME_REGEX.test(value)) {
      setNameError(translate("Only letters, numbers, -, _ and . allowed") || "Only letters, numbers, -, _ and . allowed");
      return false;
    }
    setNameError("");
    return true;
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setName(value);
    if (value) validateName(value);
    else setNameError("");
  };

  const handleAddModel = (model: { value: string }) => {
    if (!models.includes(model.value)) {
      setModels([...models, model.value]);
    }
  };

  const handleDeselectModel = (model: { value: string }) => {
    setModels(models.filter((m) => m !== model.value));
  };

  const handleRemoveModel = (index: number) => {
    setModels(models.filter((_, i) => i !== index));
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const newModels = [...models];
    [newModels[index - 1], newModels[index]] = [newModels[index], newModels[index - 1]];
    setModels(newModels);
  };

  const handleMoveDown = (index: number) => {
    if (index === models.length - 1) return;
    const newModels = [...models];
    [newModels[index], newModels[index + 1]] = [newModels[index + 1], newModels[index]];
    setModels(newModels);
  };

  const handleSave = async () => {
    if (!validateName(name)) return;
    setSaving(true);
    await onSave({ name: name.trim(), models, kind: comboType });
    setSaving(false);
  };

  const isEdit = !!combo;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={isEdit ? (translate("Edit Combo") || "Edit Combo") : (translate("Create Combo") || "Create Combo")}
      >
        <div className="flex flex-col gap-3">
          {/* Name */}
          <div>
            <Input
              label={translate("Combo Name") || "Combo Name"}
              value={name}
              onChange={handleNameChange}
              placeholder="meu-combo"
              error={nameError}
            />
            <p className="mt-1 text-xs text-text-muted">
              {translate("Only letters, numbers, -, _ and . are allowed")}
            </p>
          </div>

          {!isEdit && (
            <div>
              <Label className="mb-1.5 block">{translate("Type") || "Type"}</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setComboType("llm")}
                  className={cn("rounded-lg border p-3 text-left transition-colors", comboType === "llm" ? "border-primary bg-primary/5" : "border-border hover:bg-muted")}
                >
                  <span className="block text-sm font-medium text-text-main">{translate("Model list") || "Model list"}</span>
                  <span className="mt-1 block text-xs text-text-muted">{translate("Fallback, round robin or fusion in manual order.") || "Fallback, round robin or fusion in manual order."}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setComboType("smart")}
                  className={cn("rounded-lg border p-3 text-left transition-colors", comboType === "smart" ? "border-primary bg-primary/5" : "border-border hover:bg-muted")}
                >
                  <span className="block text-sm font-medium text-text-main">{translate("Smart routing") || "Smart routing"}</span>
                  <span className="mt-1 block text-xs text-text-muted">{translate("Chooses by task, complexity, cost and capabilities.") || "Chooses by task, complexity, cost and capabilities."}</span>
                </button>
              </div>
            </div>
          )}

          {/* Models */}
          <div>
            <Label className="mb-1.5 block">{comboType === "smart" ? (translate("Global overrides (optional)") || "Global overrides (optional)") : "Models"}</Label>

            {models.length === 0 ? (
              <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border bg-muted/50 py-4 text-center">
                <Layers className="text-text-muted" />
                <p className="text-xs text-text-muted">{comboType === "smart" ? (translate("Active inventory will be used automatically") || "Active inventory will be used automatically") : (translate("No models added yet") || "No models added yet")}</p>
              </div>
            ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis, restrictToParentElement]}>
              <SortableContext items={modelItems.map((m) => m.uid)} strategy={verticalListSortingStrategy}>
                <div className="flex max-h-[55vh] min-w-0 flex-col gap-1 overflow-y-auto sm:max-h-[350px]">
                  {modelItems.map(({ uid, model }, index) => (
                    <ModelItem
                      key={uid}
                      id={uid}
                      index={index}
                      model={model}
                      isFirst={index === 0}
                      isLast={index === modelItems.length - 1}
                      onEdit={(newVal) => {
                        const updated = [...models];
                        updated[index] = newVal;
                        setModels(updated);
                      }}
                      onMoveUp={() => handleMoveUp(index)}
                      onMoveDown={() => handleMoveDown(index)}
                      onRemove={() => handleRemoveModel(index)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            )}

            {/* Add Model button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowModelSelect(true)}
              className="mt-2 min-h-10 w-full border-dashed"
            >
              <Plus data-icon="inline-start" />
              {translate("Add Model") || "Add Model"}
            </Button>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <Button onClick={onClose} variant="ghost" fullWidth size="sm" className="min-h-11 sm:min-h-9">
              {translate("Cancel") || "Cancel"}
            </Button>
            <Button
              onClick={handleSave}
              fullWidth
              size="sm"
              className="min-h-11 sm:min-h-9"
              disabled={!name.trim() || !!nameError || saving}
            >
              {saving ? translate("Saving...") || "Saving..." : isEdit ? translate("Save") : translate("Create")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Model Select Modal */}
      {showModelSelect && (
        <ModelSelectModal
          isOpen={showModelSelect}
          onClose={() => setShowModelSelect(false)}
          onSelect={handleAddModel}
          onDeselect={handleDeselectModel}
          activeProviders={activeProviders as unknown as ActiveProvider[]}
          modelAliases={modelAliases}
          title={translate("Add Model to Combo") || "Add Model to Combo"}
          kindFilter={kindFilter}
          addedModelValues={models}
          closeOnSelect={false}
        />
      )}
    </>
  );
}

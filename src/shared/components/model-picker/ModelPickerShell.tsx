"use client";

import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Pencil, Search, SearchX, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";
import { getStoredModelTestLatencies } from "@/shared/utils/modelTestLatency";
import {
  filterPickerGroups,
  sortPickerModels,
  type PickerGroup,
  type PickerModel,
  type PickerSortMode,
} from "./modelPickerData";

const SORT_OPTIONS: { mode: PickerSortMode; label: string }[] = [
  { mode: "default", label: "Default" },
  { mode: "fastest", label: "Fastest" },
  { mode: "alpha", label: "A-Z" },
];

function t(text: string): string {
  return translate(text) || text;
}

function initials(group: PickerGroup): string {
  return group.name.slice(0, 2).toUpperCase();
}

export interface ModelPickerShellProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** A line of guidance above the list (e.g. how multi-select behaves). */
  note?: ReactNode;
  groups: PickerGroup[];
  /** Keys shown as selected. One for a single choice, many for multi-select. */
  selectedKeys: readonly string[];
  /** Provider preselected in the rail each time the picker opens; null = all. */
  initialGroupId?: string | null;
  onPick: (model: PickerModel, group: PickerGroup) => void;
}

/**
 * The one model picker of the platform: provider rail on the left, models on the
 * right, search and sort on top. The chat and every "select a model" dialog
 * (combos, CLI tools, tiebreaker…) render through it, so they cannot drift apart
 * the way the old chip-cloud dialog did. Callers adapt their own data into
 * `PickerGroup`s and decide what a pick means.
 */
export default function ModelPickerShell({
  isOpen, onClose, title, subtitle, note, groups, selectedKeys, initialGroupId = null, onPick,
}: ModelPickerShellProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(initialGroupId);
  const [sortMode, setSortMode] = useState<PickerSortMode>("default");
  // Searching walks the whole catalogue (one provider alone passes 300 models):
  // the input reads the urgent value and the list the deferred one.
  const query = useDeferredValue(searchQuery);
  const latencies = useMemo(() => (isOpen ? getStoredModelTestLatencies() : {}), [isOpen]);
  const selected = useMemo(() => new Set(selectedKeys), [selectedKeys]);

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery("");
      return;
    }
    setSelectedGroupId(initialGroupId);
  }, [isOpen, initialGroupId]);

  // Filtering and sorting are independent steps: changing the sort must not redo the filter.
  const matchedGroups = useMemo(
    () => filterPickerGroups(groups.filter((g) => !selectedGroupId || g.id === selectedGroupId), query),
    [groups, selectedGroupId, query],
  );
  const visibleGroups = useMemo(
    () => matchedGroups.map((g) => ({ ...g, models: sortPickerModels(g.models, sortMode, latencies) })),
    [matchedGroups, sortMode, latencies],
  );
  const totalModels = useMemo(() => groups.reduce((sum, g) => sum + g.models.length, 0), [groups]);

  const renderModel = (model: PickerModel, group: PickerGroup) => {
    const isSelected = selected.has(model.key);
    return (
      <button
        key={`${group.id}:${model.key}`}
        type="button"
        aria-pressed={isSelected}
        title={model.placeholder ? t("Select to fill, then edit the model ID in the field") : undefined}
        onClick={() => onPick(model, group)}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
          model.placeholder
            ? "border border-dashed border-border italic text-text-muted hover:border-primary/50 hover:text-primary"
            : isSelected ? "bg-primary/10 text-primary" : "text-text-main hover:bg-muted",
        )}
      >
        {model.placeholder ? <Pencil className="size-4 shrink-0" aria-hidden /> : null}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-medium">
            <span className="truncate">{model.name}</span>
            {model.custom ? <span className="text-[10px] font-normal opacity-60">{t("Custom")}</span> : null}
            {model.badges}
          </p>
          {model.subtitle ? <p className="truncate text-xs text-text-muted">{model.subtitle}</p> : null}
        </div>
        {isSelected && !model.placeholder ? <Check className="size-4 shrink-0" aria-hidden /> : null}
      </button>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="max-w-3xl gap-0 overflow-hidden rounded-[14px] border border-border-subtle bg-surface p-0 shadow-[var(--shadow-elev)] ring-0">
        <div className="flex min-w-0 items-start justify-between gap-3 border-b border-border-subtle p-3 sm:p-4">
          <div className="min-w-0">
            <DialogTitle className="text-base font-semibold text-text-main sm:text-lg">{title}</DialogTitle>
            {/* The subtitle only restates the dialog's purpose; on a phone that row
                costs more list rows than it explains. */}
            {subtitle ? <p className="mt-0.5 hidden text-sm text-text-muted sm:block">{subtitle}</p> : null}
          </div>
          <Button type="button" onClick={onClose} aria-label={t("Close")} variant="ghost" size="icon-sm" className="shrink-0"><X className="size-5" /></Button>
        </div>
        <div className="flex min-w-0 flex-col gap-2 border-b border-border-subtle p-3 sm:p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t("Search by model or provider...")} className="pl-9" autoFocus />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-muted">{t("Sort:")}</span>
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.mode}
                type="button"
                onClick={() => setSortMode(option.mode)}
                className={cn(
                  "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                  sortMode === option.mode ? "bg-primary/10 text-primary" : "text-text-muted hover:bg-muted hover:text-text-main",
                )}
              >
                {option.mode === "fastest" && <Zap className="size-3" />}
                {t(option.label)}
              </button>
            ))}
          </div>
          {note ? <div className="rounded-lg bg-primary/8 px-2.5 py-2 text-xs text-text-muted">{note}</div> : null}
        </div>
        {/* min-w-0 is load-bearing: DialogContent is a grid, so without it these
            tracks size to the provider strip's max-content (~1500px with a dozen
            providers). The dialog's overflow-hidden then clipped everything to the
            right — including the close button — instead of the strip scrolling. */}
        <div className="flex min-h-0 min-w-0 max-h-[70dvh] flex-col sm:max-h-[60vh] sm:flex-row">
          {/* Below sm the provider list is a horizontal strip: as a fixed 13rem
              rail it left almost no width for the model names beside it. */}
          <aside className="flex w-full min-w-0 shrink-0 gap-1 overflow-x-auto border-b border-border-subtle p-2 custom-scrollbar sm:w-52 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r">
            <button type="button" onClick={() => setSelectedGroupId(null)} className={cn("flex shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors sm:w-full", selectedGroupId === null ? "bg-primary text-primary-foreground" : "text-text-main hover:bg-muted")}>
              <span className="whitespace-nowrap">{t("All providers")}</span><span className={cn("text-xs", selectedGroupId === null ? "text-primary-foreground/80" : "text-text-muted")}>{totalModels}</span>
            </button>
            {groups.map((group) => (
              <button key={group.id} type="button" onClick={() => setSelectedGroupId(group.id)} className={cn("flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors sm:w-full", selectedGroupId === group.id ? "bg-primary text-primary-foreground" : "text-text-main hover:bg-muted")}>
                <ProviderIcon providerId={group.iconProviderId ?? group.id} alt={group.name} size={18} fallbackText={initials(group)} />
                <span className="min-w-0 flex-1 truncate whitespace-nowrap">{group.name}</span><span className={cn("text-xs", selectedGroupId === group.id ? "text-primary-foreground/80" : "text-text-muted")}>{group.models.length}</span>
              </button>
            ))}
          </aside>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-2 custom-scrollbar">
            {selectedGroupId && visibleGroups[0]
              ? visibleGroups[0].models.map((model) => renderModel(model, visibleGroups[0]!))
              : visibleGroups.map((group) => (
                <section key={group.id} className="mb-3">
                  <div className="sticky top-0 flex items-center gap-1.5 bg-surface px-3 py-1.5 text-xs font-medium text-text-muted"><ProviderIcon providerId={group.iconProviderId ?? group.id} alt={group.name} size={14} fallbackText={initials(group)} /><span className="uppercase">{group.name}</span><span>· {group.models.length}</span></div>
                  {group.models.map((model) => renderModel(model, group))}
                </section>
              ))}
            {visibleGroups.length === 0 ? <div className="flex flex-col items-center gap-2 py-10 text-text-muted"><SearchX className="size-5" /><p className="text-sm">{t("No models found")}</p></div> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

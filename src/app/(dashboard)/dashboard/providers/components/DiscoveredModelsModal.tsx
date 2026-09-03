"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/shared/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Loader2, Search } from "lucide-react";
import { translate } from "@/i18n/runtime";
import type { DiscoveredModel } from "./useModelDiscovery";

interface DiscoveredModelsModalProps {
  isOpen: boolean;
  onClose: () => void;
  models: DiscoveredModel[] | null;
  loading: boolean;
  error: string;
  /** Ids already present on the card, shown as added rather than offered again. */
  existingIds: Set<string>;
  onAdd: (modelIds: string[]) => Promise<void> | void;
}

/** Picker over the models a provider reports, so they can be added without retyping ids. */
export default function DiscoveredModelsModal({
  isOpen, onClose, models, loading, error, existingIds, onAdd,
}: DiscoveredModelsModalProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [adding, setAdding] = useState(false);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = models ?? [];
    if (!needle) return rows;
    return rows.filter((model) => `${model.id} ${model.name ?? ""}`.toLowerCase().includes(needle));
  }, [models, query]);

  const toggle = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const close = () => {
    setQuery("");
    setSelected(new Set());
    onClose();
  };

  const confirm = async () => {
    if (selected.size === 0) return;
    setAdding(true);
    try {
      await onAdd([...selected]);
      close();
    } finally {
      setAdding(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title={translate("Provider models") || "Provider models"} onClose={close}>
      <div className="flex min-h-0 flex-col gap-3">
        {loading ? (
          <p className="flex items-center gap-2 py-8 justify-center text-sm text-text-muted">
            <Loader2 className="size-4 animate-spin" />
            {translate("Loading models...") || "Loading models..."}
          </p>
        ) : error ? (
          <p className="py-6 text-center text-sm text-destructive">{error}</p>
        ) : (
          <>
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
              <Input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={translate("Search...") || "Search..."}
                className="pl-9"
              />
            </div>
            <div className="max-h-[45vh] min-h-0 overflow-y-auto custom-scrollbar rounded-lg border border-border">
              {visible.length === 0 ? (
                <p className="py-8 text-center text-sm text-text-muted">{translate("No models found") || "No models found"}</p>
              ) : (
                visible.map((model) => {
                  const already = existingIds.has(model.id);
                  const isSelected = selected.has(model.id);
                  return (
                    <button
                      key={model.id}
                      type="button"
                      disabled={already}
                      onClick={() => toggle(model.id)}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors ${already ? "opacity-50" : "hover:bg-muted"} ${isSelected ? "bg-primary/10" : ""}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{model.name || model.id}</span>
                        {model.name && model.name !== model.id ? (
                          <span className="block truncate font-mono text-[11px] text-text-muted">{model.id}</span>
                        ) : null}
                      </span>
                      {already ? (
                        <span className="shrink-0 text-[11px] text-text-muted">{translate("Added") || "Added"}</span>
                      ) : isSelected ? (
                        <Check className="size-4 shrink-0 text-primary" />
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
            <div className="flex gap-2">
              <Button onClick={confirm} fullWidth disabled={selected.size === 0 || adding}>
                {adding
                  ? translate("Adding...") || "Adding..."
                  : `${translate("Add") || "Add"}${selected.size > 0 ? ` (${selected.size})` : ""}`}
              </Button>
              <Button onClick={close} variant="ghost" fullWidth>{translate("Cancel") || "Cancel"}</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

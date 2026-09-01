"use client";

import { useState } from "react";
import { Card, ConfirmModal } from "@/shared/components";
import { Button } from "@/components/ui/button";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { useNotificationStore } from "@/store/notificationStore";
import { translate } from "@/i18n/runtime";
import { Layers, Plus } from "lucide-react";
import type { CombosClientProps, ComboView, Strategy, ConfirmState, CapEntry } from "./combo-types";
import { normalizeCombos, normalizeCapacityAdapter } from "./combo-types";
import { ComboCard } from "./ComboCard";
import { ComboFormModal } from "./ComboFormModal";
import { CapacityAdapterSection } from "./CapacityAdapterSection";

export default function CombosClient({ initialCombos, initialProviders, initialSettings, initialAliases }: CombosClientProps) {
  const notify = useNotificationStore();
  const [combos, setCombos] = useState<ComboView[]>(() => normalizeCombos(initialCombos));
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCombo, setEditingCombo] = useState<ComboView | null>(null);
  const activeProviders = initialProviders;
  const [comboStrategies, setComboStrategies] = useState<Record<string, Strategy>>((initialSettings.comboStrategies || {}) as Record<string, Strategy>);
  const [capacityAdapter, setCapacityAdapter] = useState<Record<string, CapEntry>>(normalizeCapacityAdapter(initialSettings.capacityAdapter as Record<string, unknown> | undefined));
  const { getCaps } = useModelCaps();
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const { copied, copy } = useCopyToClipboard();

  const handleSetCapacityAdapter = async (next: Record<string, CapEntry>) => {
    const previous = capacityAdapter; setCapacityAdapter(next);
    try {
      const r = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ capacityAdapter: next }) });
      if (!r.ok) throw new Error(`settings ${r.status}`);
    } catch (error) { setCapacityAdapter(previous); notify.error("Failed to save adapter settings"); console.error("Error updating capacity adapter:", error); }
  };

  const handleCreate = async (data: { name: string; models: string[]; kind?: string | null }) => {
    try {
      const res = await fetch("/api/combos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (res.ok) { const cr = await fetch("/api/combos"); if (cr.ok) { const d = await cr.json(); setCombos(normalizeCombos(d.combos)); } setShowCreateModal(false); }
      else { const err = await res.json(); notify.error(err.error || "Failed to create combo"); }
    } catch (error) { console.error("Error creating combo:", error); }
  };

  const handleUpdate = async (id: string, data: { name: string; models: string[] }) => {
    try {
      const res = await fetch(`/api/combos/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (res.ok) { const cr = await fetch("/api/combos"); if (cr.ok) { const d = await cr.json(); setCombos(normalizeCombos(d.combos)); } setEditingCombo(null); }
      else { const err = await res.json(); notify.error(err.error || "Failed to update combo"); }
    } catch (error) { console.error("Error updating combo:", error); }
  };

  const handleDelete = async (id: string) => {
    setConfirmState({
      title: translate("Delete Combo") || "Delete Combo", message: translate("Delete this combo?") || "Delete this combo?",
      onConfirm: async () => {
        setConfirmState(null);
        try { const res = await fetch(`/api/combos/${id}`, { method: "DELETE" }); if (res.ok) setCombos((c) => c.filter((combo) => combo.id !== id)); else notify.error(translate("Failed to delete combo") || "Failed to delete combo"); }
        catch (error) { console.error("Error deleting combo:", error); }
      }
    });
  };

  const handleSetComboStrategy = async (comboName: string, patch: Partial<Strategy>) => {
    const previous = comboStrategies; const updated = { ...comboStrategies };
    const next = { ...(updated[comboName] || {}), ...patch };
    const usesDefault = !next.fallbackStrategy || next.fallbackStrategy === "fallback";
    if (usesDefault && !next.judgeModel) delete updated[comboName]; else updated[comboName] = next;
    setComboStrategies(updated);
    try {
      const r = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comboStrategies: updated }) });
      if (!r.ok) throw new Error(`settings ${r.status}`);
    } catch (error) { setComboStrategies(previous); notify.error("Failed to save combo strategy"); console.error("Error updating combo strategy:", error); }
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <section aria-labelledby="combo-strategies" className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p id="combo-strategies" className="mt-1 text-sm text-text-muted">{translate("Group models under a name and choose a strategy per combo:")}</p>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm text-text-muted lg:grid-cols-3">
            <div><dt className="font-medium text-text-main">Fallback</dt><dd>{translate("Tries models in order and moves to the next after a failure.")}</dd></div>
            <div><dt className="font-medium text-text-main">Round Robin</dt><dd>{translate("Rotates models between requests to distribute load.")}</dd></div>
            <div><dt className="font-medium text-text-main">Fusion</dt><dd>{translate("Runs the panel in parallel and lets a judge synthesize the response (N+1 calls).")}</dd></div>
          </dl>
        </div>
        <Button size="lg" onClick={() => setShowCreateModal(true)} className="min-h-11 w-full whitespace-nowrap sm:w-auto"><Plus data-icon="inline-start" />{translate("Create Combo") || "Create Combo"}</Button>
      </section>
      {combos.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4"><Layers className="size-8" /></div>
            <p className="text-text-main font-medium mb-1">{translate("No combos yet") || "No combos yet"}</p>
            <p className="text-sm text-text-muted mb-4">{translate("Create model combos with fallback support") || "Create model combos with fallback support"}</p>
            <Button icon={<Plus className="size-4" />} onClick={() => setShowCreateModal(true)} className="w-full sm:w-auto">{translate("Create Combo") || "Create Combo"}</Button>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {combos.map((combo) => (
            <ComboCard key={combo.id} combo={combo} getCaps={getCaps} activeProviders={activeProviders} copied={copied} onCopy={copy} onEdit={() => setEditingCombo(combo)} onDelete={() => handleDelete(combo.id)} strategy={comboStrategies[combo.name] || {}} onSetStrategy={(patch) => handleSetComboStrategy(combo.name, patch)} />
          ))}
        </div>
      )}
      <CapacityAdapterSection capacityAdapter={capacityAdapter} onChange={handleSetCapacityAdapter} activeProviders={activeProviders} getCaps={getCaps} />
      {showCreateModal && <ComboFormModal key="create" isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} onSave={handleCreate} activeProviders={activeProviders} modelAliases={initialAliases} />}
      {editingCombo && <ComboFormModal key={editingCombo.id} isOpen={!!editingCombo} combo={editingCombo} onClose={() => setEditingCombo(null)} onSave={(data) => handleUpdate(editingCombo.id, data)} activeProviders={activeProviders} modelAliases={initialAliases} />}
      <ConfirmModal isOpen={!!confirmState} onClose={() => setConfirmState(null)} onConfirm={() => { void confirmState?.onConfirm(); }} title={confirmState?.title || "Confirm"} message={confirmState?.message} variant="danger" />
    </div>
  );
}

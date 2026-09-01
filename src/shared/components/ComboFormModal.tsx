"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import ModelSelectModal from "./ModelSelectModal";
import type { ActiveProvider } from "./ModelSelectModal";
import { X } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { ComboNameField, ComboModelsList } from "./ComboFormParts";

const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

interface Combo { name?: string; models?: string[]; }
interface ComboFormModalProps { isOpen: boolean; combo?: Combo | null; onClose: () => void; onSave: (data: { name: string; models: string[] }) => Promise<void>; activeProviders: ActiveProvider[]; kindFilter?: string | null; forcePrefix?: string; title?: string; }

export default function ComboFormModal({ isOpen, combo, onClose, onSave, activeProviders, kindFilter = null, forcePrefix = "", title }: ComboFormModalProps) {
  const initialName = combo?.name ? (forcePrefix && combo.name.startsWith(forcePrefix) ? combo.name.slice(forcePrefix.length) : combo.name) : "";
  const [name, setName] = useState(initialName);
  const [models, setModels] = useState<string[]>(combo?.models || []);
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [modelAliases, setModelAliases] = useState<Record<string, string>>({});

  useEffect(() => { if (isOpen) fetch("/api/models/alias").then((r) => r.ok ? r.json() : null).then((d) => d && setModelAliases(d.aliases || {})).catch(() => {}); }, [isOpen]);

  const validateName = (v: string): boolean => {
    if (!v.trim()) { setNameError(translate("Name is required") || "Name is required"); return false; }
    if (!VALID_NAME_REGEX.test(forcePrefix + v)) { setNameError(translate("Only letters, numbers, -, _ and .") || "Only letters, numbers, -, _ and ."); return false; }
    setNameError(""); return true;
  };
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => { let v = e.target.value; if (forcePrefix && v.startsWith(forcePrefix)) v = v.slice(forcePrefix.length); setName(v); if (v) validateName(v); else setNameError(""); };
  const handleAddModel = (m: { value: string }) => { if (!models.includes(m.value)) setModels([...models, m.value]); };
  const handleDeselectModel = (m: { value: string }) => setModels(models.filter((x) => x !== m.value));
  const handleRemoveModel = (i: number) => setModels(models.filter((_, idx) => idx !== i));
  const handleMoveUp = (i: number) => { if (i === 0) return; const a = [...models]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setModels(a); };
  const handleMoveDown = (i: number) => { if (i === models.length - 1) return; const a = [...models]; [a[i], a[i + 1]] = [a[i + 1], a[i]]; setModels(a); };
  const handleSave = async () => { if (!validateName(name)) return; setSaving(true); await onSave({ name: forcePrefix + name.trim(), models }); setSaving(false); };
  const isEdit = !!combo;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent showCloseButton={false} className={cn("bg-surface border border-border-subtle rounded-[14px]", "shadow-[var(--shadow-elev)] ring-0 gap-0 p-0", "max-w-md")}>
          <div className="flex items-center justify-between p-2 border-b border-border-subtle">
            <DialogTitle className="text-lg font-semibold text-text-main ml-2">{title || (isEdit ? translate("Edit Combo") || "Edit Combo" : translate("Create Combo") || "Create Combo")}</DialogTitle>
            <Button onClick={onClose} aria-label={translate("Close") || "Close"} variant="ghost" size="sm" className="p-1.5"><X className="size-5" /></Button>
          </div>
          <div className="p-6 max-h-[calc(85vh-100px)] overflow-y-auto custom-scrollbar">
            <div className="flex flex-col gap-3">
              <ComboNameField forcePrefix={forcePrefix} name={name} nameError={nameError} handleNameChange={handleNameChange} />
              <ComboModelsList models={models} onAdd={() => setShowModelSelect(true)} onEdit={(i, v) => { const a = [...models]; a[i] = v; setModels(a); }} onMoveUp={handleMoveUp} onMoveDown={handleMoveDown} onRemove={handleRemoveModel} />
              <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                <Button onClick={onClose} variant="ghost" fullWidth size="sm">{translate("Cancel") || "Cancel"}</Button>
                <Button onClick={handleSave} fullWidth size="sm" disabled={!name.trim() || !!nameError || saving}>{saving ? translate("Saving...") || "Saving..." : isEdit ? translate("Save") || "Save" : translate("Create") || "Create"}</Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {showModelSelect && <ModelSelectModal isOpen={showModelSelect} onClose={() => setShowModelSelect(false)} onSelect={handleAddModel} onDeselect={handleDeselectModel} activeProviders={activeProviders} modelAliases={modelAliases} title={translate("Add Model to Combo") || "Add Model to Combo"} kindFilter={kindFilter} addedModelValues={models} closeOnSelect={false} />}
    </>
  );
}

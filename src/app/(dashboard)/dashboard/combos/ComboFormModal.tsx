"use client";

import { useState } from "react";
import { Modal, ModelSelectModal } from "@/shared/components";
import { FormInput as Input } from "@/shared/components/FormInput";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ActiveProvider } from "@/shared/components/ModelSelectModal";
import type { Connection } from "@/lib/data-access";
import type { ComboView } from "./combo-types";
import { VALID_NAME_REGEX } from "./combo-types";
import { SortableModelList } from "./SortableModelList";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";
import { Layers, Plus } from "lucide-react";

export function ComboFormModal({ isOpen, combo, onClose, onSave, activeProviders, modelAliases, kindFilter = null }: {
  isOpen: boolean;
  combo?: ComboView;
  onClose: () => void;
  onSave: (data: { name: string; models: string[]; kind?: string | null }) => Promise<void>;
  activeProviders: Connection[];
  modelAliases: Record<string, string>;
  kindFilter?: string | null;
}) {
  const [name, setName] = useState(combo?.name || "");
  const [models, setModels] = useState<string[]>(combo?.models || []);
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [comboType, setComboType] = useState<"llm" | "smart">(combo?.kind === "smart" ? "smart" : "llm");

  const validateName = (value: string) => {
    if (!value.trim()) { setNameError(translate("Name is required") || "Name is required"); return false; }
    if (!VALID_NAME_REGEX.test(value)) { setNameError(translate("Only letters, numbers, -, _ and . allowed") || "Only letters, numbers, -, _ and . allowed"); return false; }
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
    if (!models.includes(model.value)) setModels([...models, model.value]);
  };

  const handleDeselectModel = (model: { value: string }) => {
    setModels(models.filter((m) => m !== model.value));
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
      <Modal isOpen={isOpen} onClose={onClose} title={isEdit ? (translate("Edit Combo") || "Edit Combo") : (translate("Create Combo") || "Create Combo")}>
        <div className="flex flex-col gap-3">
          {/* Name */}
          <div>
            <Input label={translate("Combo Name") || "Combo Name"} value={name} onChange={handleNameChange} placeholder="meu-combo" error={nameError} />
            <p className="mt-1 text-xs text-text-muted">{translate("Only letters, numbers, -, _ and . are allowed")}</p>
          </div>

          {/* Type selector (create only) */}
          {!isEdit && (
            <div>
              <Label className="mb-1.5 block">{translate("Type") || "Type"}</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => setComboType("llm")} className={cn("rounded-lg border p-3 text-left transition-colors", comboType === "llm" ? "border-primary bg-primary/5" : "border-border hover:bg-muted")}>
                  <span className="block text-sm font-medium text-text-main">{translate("Model list") || "Model list"}</span>
                  <span className="mt-1 block text-xs text-text-muted">{translate("Fallback, round robin or fusion in manual order.") || "Fallback, round robin or fusion in manual order."}</span>
                </button>
                <button type="button" onClick={() => setComboType("smart")} className={cn("rounded-lg border p-3 text-left transition-colors", comboType === "smart" ? "border-primary bg-primary/5" : "border-border hover:bg-muted")}>
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
              <SortableModelList models={models} setModels={setModels} />
            )}
            <Button variant="outline" size="sm" onClick={() => setShowModelSelect(true)} className="mt-2 min-h-10 w-full border-dashed">
              <Plus data-icon="inline-start" />
              {translate("Add Model") || "Add Model"}
            </Button>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <Button onClick={onClose} variant="ghost" fullWidth size="sm" className="min-h-11 sm:min-h-9">
              {translate("Cancel") || "Cancel"}
            </Button>
            <Button onClick={handleSave} fullWidth size="sm" className="min-h-11 sm:min-h-9" disabled={!name.trim() || !!nameError || saving}>
              {saving ? translate("Saving...") || "Saving..." : isEdit ? translate("Save") : translate("Create")}
            </Button>
          </div>
        </div>
      </Modal>

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

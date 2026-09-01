"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input as RawInput } from "@/components/ui/input";
import Input from "./Input";
import Button from "./Button";
import { ArrowDown, ArrowUp, Layers, Plus, X } from "lucide-react";
import { translate } from "@/i18n/runtime";

interface ModelItemProps {
  index: number; model: string; isFirst: boolean; isLast: boolean;
  onEdit: (v: string) => void; onMoveUp: () => void; onMoveDown: () => void; onRemove: () => void;
}

export function ModelItem({ index, model, isFirst, isLast, onEdit, onMoveUp, onMoveDown, onRemove }: ModelItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(model);
  const commit = () => { const t = draft.trim(); if (t && t !== model) onEdit(t); else setDraft(model); setEditing(false); };
  return (
    <div className="group flex min-w-0 items-center gap-1.5 rounded-md bg-black/[0.02] px-2 py-1 transition-colors hover:bg-black/[0.04] dark:bg-white/[0.02] dark:hover:bg-white/[0.04]">
      <span className="text-[10px] font-medium text-text-muted w-3 text-center shrink-0">{index + 1}</span>
      {editing ? (
        <RawInput autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(model); setEditing(false); } }} className="min-w-0 flex-1 px-1.5 py-0.5 font-mono text-xs text-text-main" />
      ) : (
        <div className="min-w-0 flex-1 cursor-text truncate rounded px-1.5 py-0.5 font-mono text-xs text-text-main hover:bg-surface-2/50" onClick={() => setEditing(true)} title={translate("Click to edit") || "Click to edit"}>{model}</div>
      )}
      <div className="flex shrink-0 items-center gap-0.5">
        <Button onClick={onMoveUp} disabled={isFirst} variant="ghost" size="icon-xs" className={`${isFirst ? "text-text-muted/20 cursor-not-allowed" : "text-text-muted hover:text-primary hover:bg-surface-2/50"}`} title={translate("Move up") || "Move up"}><ArrowUp className="size-3" /></Button>
        <Button onClick={onMoveDown} disabled={isLast} variant="ghost" size="icon-xs" className={`${isLast ? "text-text-muted/20 cursor-not-allowed" : "text-text-muted hover:text-primary hover:bg-surface-2/50"}`} title={translate("Move down") || "Move down"}><ArrowDown className="size-3" /></Button>
      </div>
      <Button onClick={onRemove} variant="ghost" size="icon-xs" className="hover:bg-red-500/10 text-text-muted hover:text-red-500 transition-all" title={translate("Remove") || "Remove"}><X className="size-3" /></Button>
    </div>
  );
}

interface ComboNameFieldProps {
  forcePrefix: string; name: string; nameError: string;
  handleNameChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function ComboNameField({ forcePrefix, name, nameError, handleNameChange }: ComboNameFieldProps) {
  return (
    <div>
      {forcePrefix ? (
        <>
          <Label className="mb-1 block">{translate("Combo Name") || "Combo Name"}</Label>
          <div className="flex items-stretch">
            <span className="inline-flex items-center px-2 rounded-l border border-r-0 border-black/10 dark:border-white/10 bg-black/[0.04] dark:bg-white/[0.04] text-text-muted font-mono text-sm">{forcePrefix}</span>
            <RawInput value={name} onChange={handleNameChange} placeholder="my-combo" className="flex-1 min-w-0 rounded-l-none px-2 py-1.5 font-mono text-sm" />
          </div>
          {nameError && <p className="text-[11px] text-red-500 mt-0.5">{nameError}</p>}
        </>
      ) : (
        <Input label={translate("Combo Name") || "Combo Name"} value={name} onChange={handleNameChange} placeholder="meu-combo" error={nameError} />
      )}
      <p className="text-[10px] text-text-muted mt-0.5">{forcePrefix ? translate("Auto prefix") + ` "${forcePrefix}". ` : ""}{translate("Only letters, numbers, -, _ and .") || "Only letters, numbers, -, _ and ."}</p>
    </div>
  );
}

interface ComboModelsListProps {
  models: string[];
  onAdd: () => void; onEdit: (i: number, v: string) => void;
  onMoveUp: (i: number) => void; onMoveDown: (i: number) => void; onRemove: (i: number) => void;
}

export function ComboModelsList({ models, onAdd, onEdit, onMoveUp, onMoveDown, onRemove }: ComboModelsListProps) {
  return (
    <div>
      <Label className="mb-1.5 block">{translate("Models") || "Models"}</Label>
      {models.length === 0 ? (
        <div className="text-center py-4 border border-dashed border-black/10 dark:border-white/10 rounded-lg bg-black/[0.01] dark:bg-white/[0.01]"><Layers className="size-4" /><p className="text-xs text-text-muted">{translate("No models added yet") || "No models added yet"}</p></div>
      ) : (
        <div className="flex max-h-[55vh] min-w-0 flex-col gap-1 overflow-y-auto sm:max-h-[350px]">
          {models.map((m, i) => <ModelItem key={i} index={i} model={m} isFirst={i === 0} isLast={i === models.length - 1} onEdit={(v) => onEdit(i, v)} onMoveUp={() => onMoveUp(i)} onMoveDown={() => onMoveDown(i)} onRemove={() => onRemove(i)} />)}
        </div>
      )}
      <Button onClick={onAdd} variant="outline" size="sm" className="w-full mt-2 py-2 border-dashed text-xs text-primary font-medium hover:text-primary hover:border-primary/50 transition-colors flex items-center justify-center gap-1"><Plus className="size-4" />{translate("Add Model") || "Add Model"}</Button>
    </div>
  );
}

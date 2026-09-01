"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input as RawInput } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, GripVertical, X } from "lucide-react";

export function ModelItem({ id, index, model, isFirst, isLast, onEdit, onMoveUp, onMoveDown, onRemove }: {
  id: string; index: number; model: string; isFirst: boolean; isLast: boolean;
  onEdit: (newVal: string) => void; onMoveUp: () => void; onMoveDown: () => void; onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), opacity: isDragging ? 0.4 : 1, zIndex: isDragging ? 999 : undefined };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(model);
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== model) onEdit(trimmed); else setDraft(model);
    setEditing(false);
  };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") { setDraft(model); setEditing(false); }
  };

  return (
    <div ref={setNodeRef} style={style} className={cn("group flex min-w-0 items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 transition-colors hover:bg-muted", isDragging && "shadow-md ring-1 ring-primary/30")}>
      <Button {...attributes} {...listeners} variant="ghost" size="icon-sm" type="button" className="size-9 cursor-grab touch-none active:cursor-grabbing sm:size-7" title="Drag to reorder" aria-label={`Drag ${model} to reorder`}>
        <GripVertical />
      </Button>
      <span className="w-4 shrink-0 text-center text-xs font-medium text-text-muted">{index + 1}</span>
      {editing ? (
        <RawInput autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={handleKeyDown} className="min-w-0 flex-1 px-1.5 py-0.5 font-mono text-xs text-text-main" aria-label={`Model ${index + 1}`} />
      ) : (
        <button type="button" className="min-w-0 flex-1 cursor-text truncate rounded px-1.5 py-0.5 text-left font-mono text-xs text-text-main hover:bg-surface-2/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setEditing(true)} title="Click to edit" aria-label={`Edit ${model}`}>
          {model}
        </button>
      )}
      <div className="flex shrink-0 items-center gap-0.5">
        <Button variant="ghost" size="icon-xs" onClick={onMoveUp} disabled={isFirst} className="size-9 sm:size-6" title="Move up" aria-label={`Move ${model} up`}><ArrowUp /></Button>
        <Button variant="ghost" size="icon-xs" onClick={onMoveDown} disabled={isLast} className="size-9 sm:size-6" title="Move down" aria-label={`Move ${model} down`}><ArrowDown /></Button>
      </div>
      <Button variant="ghost" size="icon-xs" onClick={onRemove} className="size-9 text-destructive sm:size-6" title="Remove" aria-label={`Remove ${model}`}><X /></Button>
    </div>
  );
}

"use client";

import { useId, useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { translate } from "@/i18n/runtime";

const t = (text: string): string => translate(text) || text;

/** Above this many items the list gets a filter box. */
const SEARCH_THRESHOLD = 8;

interface Item {
  id: string;
  label: string;
  description?: string;
}

interface Props {
  items: Item[];
  selected: string[];
  readOnly: boolean;
  onChange: (selected: string[]) => void;
  emptyText: string;
}

/** A checkbox per plugin or skill. Ids no longer in the catalog stay selected, listed last, so saving never drops them silently. */
export default function AccessChecklistSection({ items, selected, readOnly, onChange, emptyText }: Props) {
  const idPrefix = useId();
  const [query, setQuery] = useState("");
  const chosen = new Set(selected);
  const known = new Set(items.map((item) => item.id));
  const orphans: Item[] = selected.filter((id) => !known.has(id)).map((id) => ({ id, label: id, description: t("No longer installed") }));
  const all = [...items, ...orphans];
  const needle = query.trim().toLowerCase();
  const visible = needle ? all.filter((item) => `${item.label} ${item.id}`.toLowerCase().includes(needle)) : all;

  const toggle = (id: string, checked: boolean) => {
    onChange(checked ? [...selected, id] : selected.filter((value) => value !== id));
  };

  if (all.length === 0) return <p className="text-xs text-text-muted">{emptyText}</p>;

  return (
    <div className="flex flex-col gap-2">
      {all.length > SEARCH_THRESHOLD && (
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Filter...")} aria-label={t("Filter")} className="h-8 text-xs" />
      )}
      <ul className="flex max-h-64 flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border custom-scrollbar">
        {visible.map((item) => {
          const inputId = `${idPrefix}-${item.id}`;
          return (
            <li key={item.id} className="flex items-start gap-3 px-3 py-2.5">
              <Checkbox
                id={inputId}
                checked={chosen.has(item.id)}
                disabled={readOnly}
                onCheckedChange={(checked) => toggle(item.id, checked === true)}
              />
              <label htmlFor={inputId} className="min-w-0 flex-1 cursor-pointer">
                <span className="block text-sm font-medium text-text-main">{item.label}</span>
                {item.description && <span className="mt-0.5 line-clamp-2 block text-xs text-text-muted">{item.description}</span>}
              </label>
            </li>
          );
        })}
      </ul>
      {chosen.size === 0 && <p className="text-xs text-destructive">{t("Nothing selected: none of these will be available.")}</p>}
    </div>
  );
}

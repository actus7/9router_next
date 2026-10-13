"use client";

import { useState } from "react";
import useSWR from "swr";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ModelSelectModal from "@/shared/components/ModelSelectModal";
import type { ActiveProvider } from "@/shared/components/ModelSelectModal";
import { jsonFetcher } from "@/shared/hooks/jsonFetcher";
import { translate } from "@/i18n/runtime";

const t = (text: string): string => translate(text) || text;

interface Props {
  models: string[];
  readOnly: boolean;
  onChange: (models: string[]) => void;
}

/**
 * The allowed models as removable chips. Models come from the same picker the
 * combos use (combos included, switched-off providers and models left out);
 * a pattern covers what a list cannot — `cx/*` is every Codex model, present
 * and future.
 */
export default function AccessModelsSection({ models, readOnly, onChange }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pattern, setPattern] = useState("");
  const { data: providers } = useSWR<{ connections?: ActiveProvider[] }>(pickerOpen ? "/api/providers" : null, jsonFetcher);
  const { data: aliases } = useSWR<{ aliases?: Record<string, string> }>(pickerOpen ? "/api/models/alias" : null, jsonFetcher);

  const add = (value: string) => {
    const entry = value.trim();
    if (entry && !models.includes(entry)) onChange([...models, entry]);
  };
  const remove = (value: string) => onChange(models.filter((model) => model !== value));
  const addPattern = () => {
    add(pattern);
    setPattern("");
  };

  return (
    <div className="flex flex-col gap-3">
      {models.length === 0 ? (
        <p className="rounded-lg border border-dashed border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {t("No model selected: requests for any model will be refused.")}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("Allowed models")}>
          {models.map((model) => (
            <li key={model} className="flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/50 py-0.5 pr-1 pl-2.5">
              <span className="truncate font-mono text-xs text-text-main" title={model}>{model}</span>
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-5 shrink-0 text-text-muted hover:text-destructive"
                  onClick={() => remove(model)}
                  aria-label={`${t("Remove")} ${model}`}
                >
                  <X className="size-3" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)} className="shrink-0">
            <Plus data-icon="inline-start" /> {t("Add models")}
          </Button>
          <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              addPattern();
            }}
          >
            <Input
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
              placeholder={t("or a pattern, e.g. cx/* for every model of a provider")}
              aria-label={t("Model pattern")}
              className="h-8 font-mono text-xs"
            />
            <Button type="submit" variant="ghost" size="sm" disabled={!pattern.trim()}>
              {t("Add")}
            </Button>
          </form>
        </div>
      )}

      <ModelSelectModal
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(model) => add(model.value)}
        onDeselect={(model) => remove(model.value)}
        activeProviders={providers?.connections ?? []}
        modelAliases={aliases?.aliases ?? {}}
        addedModelValues={models}
        closeOnSelect={false}
        title={t("Allow models")}
      />
    </div>
  );
}

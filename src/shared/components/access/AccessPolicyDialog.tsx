"use client";

import { useState } from "react";

import Modal from "@/shared/components/Modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";
import type { AccessField, AccessPolicy } from "@/shared/access/accessPolicy";
import type { AccessCatalog } from "@/shared/hooks/useWorkspace";
import AccessModelsSection from "./AccessModelsSection";
import AccessChecklistSection from "./AccessChecklistSection";
import AccessLimitsSection from "./AccessLimitsSection";

const t = (text: string): string => translate(text) || text;

const SECTION_COPY: Record<AccessField, { title: string; hint: string; empty: string }> = {
  models: {
    title: "Models",
    hint: "Which models and combos can be requested. A combo brings its own models along.",
    empty: "",
  },
  plugins: {
    title: "Chat tools",
    hint: "Plugins that give the chat a capability: web search, memory, image generation…",
    empty: "No tool plugin is installed.",
  },
  skills: {
    title: "Skills",
    hint: "Agent Skills that can be loaded in the chat or attached to an API key.",
    empty: "No skill is installed.",
  },
};

interface Props {
  isOpen: boolean;
  title: string;
  /** One line on whom this restricts, shown above the sections. */
  description: string;
  fields: readonly AccessField[];
  initial: AccessPolicy;
  catalog: AccessCatalog | undefined;
  readOnly?: boolean;
  onClose: () => void;
  onSave: (policy: AccessPolicy) => Promise<void>;
}

/**
 * Edits one access policy. Each section is either "everything" (the field is
 * left out of the policy) or an explicit list — the same distinction the
 * server makes, so what the screen shows is exactly what is enforced.
 */
export default function AccessPolicyDialog({ isOpen, title, description, fields, initial, catalog, readOnly = false, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<AccessPolicy>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setField = (field: AccessField, value: string[] | undefined) => {
    setDraft((current) => {
      const next = { ...current };
      if (value === undefined) delete next[field];
      else next[field] = value;
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const toolPlugins = (catalog?.plugins ?? [])
    .filter((plugin) => plugin.kind === "tool")
    .map((plugin) => ({ id: plugin.id, label: plugin.title, description: plugin.description }));
  const skills = (catalog?.skills ?? []).map((skill) => ({ id: skill.id, label: skill.name, description: skill.description }));

  const footer = readOnly ? (
    <Button variant="outline" onClick={onClose}>{t("Close")}</Button>
  ) : (
    <>
      <Button variant="ghost" onClick={onClose} disabled={saving}>{t("Cancel")}</Button>
      <Button onClick={save} disabled={saving}>{saving ? t("Saving...") : t("Save")}</Button>
    </>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="2xl" footer={footer}>
      <p className="text-sm text-text-muted">{description}</p>
      <div className="mt-5 flex flex-col gap-6">
        {fields.map((field) => {
          const copy = SECTION_COPY[field];
          const restricted = draft[field] !== undefined;
          return (
            <section key={field} aria-labelledby={`access-${field}`} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 id={`access-${field}`} className="text-sm font-semibold text-text-main">{t(copy.title)}</h3>
                  <p className="mt-0.5 text-xs text-text-muted">{t(copy.hint)}</p>
                </div>
                <div role="radiogroup" aria-label={t(copy.title)} className="flex shrink-0 rounded-lg border border-border bg-muted/40 p-0.5">
                  {[
                    { label: t("All"), on: !restricted, value: undefined },
                    { label: t("Only selected"), on: restricted, value: draft[field] ?? [] },
                  ].map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      role="radio"
                      aria-checked={option.on}
                      disabled={readOnly}
                      onClick={() => setField(field, option.value)}
                      className={cn(
                        "rounded-md px-3 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default",
                        option.on ? "bg-surface text-text-main shadow-sm" : "text-text-muted hover:text-text-main",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              {restricted && field === "models" && (
                <AccessModelsSection models={draft.models ?? []} readOnly={readOnly} onChange={(models) => setField("models", models)} />
              )}
              {restricted && field !== "models" && (
                <AccessChecklistSection
                  items={field === "plugins" ? toolPlugins : skills}
                  selected={draft[field] ?? []}
                  readOnly={readOnly}
                  onChange={(selected) => setField(field, selected)}
                  emptyText={t(copy.empty)}
                />
              )}
            </section>
          );
        })}
        <AccessLimitsSection
          limits={draft.limits}
          readOnly={readOnly}
          onChange={(limits) =>
            setDraft((current) => {
              const next = { ...current };
              if (limits === undefined) delete next.limits;
              else next.limits = limits;
              return next;
            })
          }
        />
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
    </Modal>
  );
}

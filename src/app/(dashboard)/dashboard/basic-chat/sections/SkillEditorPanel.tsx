"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SkillDraft } from "../hooks/useAgentSkills";

interface SkillEditorPanelProps {
  draft: SkillDraft | null;
  busy: boolean;
  onSave: (draft: SkillDraft) => Promise<void>;
  onCancel: () => void;
  onImportUrl: (url: string) => Promise<SkillDraft>;
}

const emptyDraft = (): SkillDraft => ({
  id: "",
  name: "",
  description: "",
  body: "",
  enabled: true,
  source: "user",
});

export default function SkillEditorPanel({
  draft,
  busy,
  onSave,
  onCancel,
  onImportUrl,
}: SkillEditorPanelProps) {
  const [form, setForm] = useState<SkillDraft>(draft ?? emptyDraft());
  const [importUrl, setImportUrl] = useState("");
  const [importError, setImportError] = useState("");

  useEffect(() => {
    setForm(draft ?? emptyDraft());
  }, [draft]);

  const update = (patch: Partial<SkillDraft>) =>
    setForm((current) => ({ ...current, ...patch }));

  const handleImport = async () => {
    setImportError("");
    try {
      const imported = await onImportUrl(importUrl.trim());
      setForm({ ...imported, enabled: false });
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : "Importação falhou",
      );
    }
  };

  return (
    <div className="mt-6 rounded-xl border border-border bg-card p-4">
      <h3 className="font-medium">
        {draft?.id ? `Editar skill: ${draft.id}` : "Nova skill"}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Formato Agent Skills: frontmatter YAML + corpo markdown.
      </p>

      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-sm">
          <span>Importar de URL (HTTPS)</span>
          <div className="flex flex-wrap gap-2">
            <Input
              value={importUrl}
              onChange={(event) => setImportUrl(event.target.value)}
              placeholder="https://raw.githubusercontent.com/.../SKILL.md"
              className="min-w-[16rem] flex-1"
            />
            <Button type="button" variant="outline" onClick={() => void handleImport()} disabled={busy}>
              Importar rascunho
            </Button>
          </div>
          {importError ? (
            <span className="text-xs text-destructive">{importError}</span>
          ) : null}
        </label>

        <label className="grid gap-1 text-sm">
          <span>Id (slug)</span>
          <Input
            value={form.id}
            onChange={(event) =>
              update({
                id: event.target.value.trim().toLowerCase(),
                name: event.target.value.trim().toLowerCase(),
              })
            }
            placeholder="minha-skill"
            disabled={Boolean(draft?.id)}
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span>Descrição (visível ao modelo antes de load_skill)</span>
          <Input
            value={form.description}
            onChange={(event) => update({ description: event.target.value })}
            placeholder="Quando usar esta skill..."
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span>Corpo (markdown)</span>
          <Textarea
            value={form.body}
            onChange={(event) => update({ body: event.target.value })}
            rows={12}
            className="font-mono text-xs"
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(event) => update({ enabled: event.target.checked })}
          />
          Ativa globalmente após salvar
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={busy || !form.id.trim() || !form.description.trim() || !form.body.trim()}
          onClick={() => void onSave(form)}
        >
          Salvar
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ChatSession, HarnessPluginSettings } from "../types";

interface PluginConfigurationProps {
  session: ChatSession | null;
  onUpdate: (settings: HarnessPluginSettings) => void;
}

interface PluginConfigField {
  key: keyof HarnessPluginSettings;
  id: string;
  label: string;
  defaultValue: number;
  min: number;
  max: number;
  step?: number;
  suffix: string;
}

const CONFIGURABLE_PLUGINS: Array<{
  id: string;
  title: string;
  description: string;
  field: PluginConfigField;
}> = [
  {
    id: "agent-loop",
    title: "Agent loop",
    description:
      "Controla como o agente despacha e continua chamadas de ferramentas.",
    field: {
      key: "maxToolSteps",
      id: "agent-loop-steps",
      label: "Máximo de etapas",
      defaultValue: 8,
      min: 1,
      max: 8,
      suffix: "etapas",
    },
  },
  {
    id: "subagent",
    title: "Subagent",
    description: "Limita quantas tarefas podem ser delegadas em uma execução.",
    field: {
      key: "maxSubagentCalls",
      id: "subagent-calls",
      label: "Máximo de delegações",
      defaultValue: 2,
      min: 0,
      max: 4,
      suffix: "delegações",
    },
  },
  {
    id: "web-search",
    title: "Web search",
    description:
      "Define o número padrão de resultados quando o agente não informa esse valor.",
    field: {
      key: "webSearchMaxResults",
      id: "web-search-results",
      label: "Resultados padrão",
      defaultValue: 5,
      min: 1,
      max: 10,
      suffix: "resultados",
    },
  },
  {
    id: "web-fetch",
    title: "Web fetch",
    description:
      "Define o limite padrão para conteúdo extraído de páginas públicas.",
    field: {
      key: "webFetchMaxCharacters",
      id: "web-fetch-characters",
      label: "Limite de conteúdo",
      defaultValue: 12000,
      min: 500,
      max: 30000,
      step: 500,
      suffix: "caracteres",
    },
  },
];

export function PluginConfiguration({
  session,
  onUpdate,
}: PluginConfigurationProps) {
  const [expandedId, setExpandedId] = useState("agent-loop");

  return (
    <div className="mt-5 grid gap-3">
      {CONFIGURABLE_PLUGINS.map((plugin) => (
        <PluginConfigCard
          key={plugin.id}
          plugin={plugin}
          value={
            session?.pluginSettings?.[plugin.field.key] ??
            plugin.field.defaultValue
          }
          disabled={!session}
          expanded={expandedId === plugin.id}
          onExpandedChange={() =>
            setExpandedId((current) => (current === plugin.id ? "" : plugin.id))
          }
          onSave={(value) => onUpdate({ [plugin.field.key]: value })}
        />
      ))}
      {!session ? (
        <p
          role="alert"
          className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
        >
          Abra ou crie um chat para salvar a configuração dos plugins.
        </p>
      ) : null}
    </div>
  );
}

function PluginConfigCard({
  plugin,
  value,
  disabled,
  expanded,
  onExpandedChange,
  onSave,
}: {
  plugin: (typeof CONFIGURABLE_PLUGINS)[number];
  value: number;
  disabled: boolean;
  expanded: boolean;
  onExpandedChange: () => void;
  onSave: (value: number) => void;
}) {
  const { field } = plugin;
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const normalized = Math.max(
    field.min,
    Math.min(field.max, Number(draft) || field.min),
  );
  const dirty = normalized !== value;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        className="flex min-h-24 w-full items-center justify-between gap-4 p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={onExpandedChange}
        aria-expanded={expanded}
        aria-controls={`${plugin.id}-configuration`}
      >
        <span>
          <span className="block text-lg font-semibold">{plugin.title}</span>
          <span className="mt-1 block text-sm leading-6 text-muted-foreground">
            {plugin.description}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "size-5 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>
      {expanded ? (
        <div
          id={`${plugin.id}-configuration`}
          className="border-t border-border px-5 py-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label htmlFor={field.id} className="text-sm font-medium">
              {field.label}
            </label>
            <div className="flex items-center gap-2">
              <Input
                id={field.id}
                className="h-10 w-28 text-right tabular-nums"
                type="number"
                min={field.min}
                max={field.max}
                step={field.step ?? 1}
                value={draft}
                disabled={disabled}
                onChange={(event) => setDraft(event.target.value)}
              />
              <span className="min-w-20 text-sm text-muted-foreground">
                {field.suffix}
              </span>
            </div>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            As mudanças só entram em vigor na próxima execução depois de salvas.
          </p>
          <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
            <Button
              variant="outline"
              disabled={disabled || !dirty}
              onClick={() => setDraft(String(value))}
            >
              Descartar
            </Button>
            <Button
              disabled={disabled || !dirty}
              onClick={() => onSave(normalized)}
            >
              Salvar
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

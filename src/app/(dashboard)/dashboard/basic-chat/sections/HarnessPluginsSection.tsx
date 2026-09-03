"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronUp, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  AGENT_PRESETS,
  HARNESS_PLUGINS,
} from "@/shared/harness/agentPlugins";
import type { ChatSession } from "../types";
import { PluginConfiguration } from "./PluginConfiguration";
import PluginCompositionPanel from "./PluginCompositionPanel";

export function PluginsSection({
  presetTitle,
  pluginCount,
  query,
  onQueryChange,
  plugins,
  enabledPluginIds,
  expandedPluginId,
  onToggleExpanded,
  onTogglePlugin,
  session,
  onUpdatePluginSettings,
}: {
  presetTitle: string;
  pluginCount: number;
  query: string;
  onQueryChange: (value: string) => void;
  plugins: readonly (typeof HARNESS_PLUGINS)[number][];
  enabledPluginIds: Set<string>;
  expandedPluginId: string | null;
  onToggleExpanded: (id: string) => void;
  onTogglePlugin: (id: string) => void;
  session: ChatSession | null;
  onUpdatePluginSettings: (
    settings: NonNullable<ChatSession["pluginSettings"]>,
  ) => void;
}) {
  const [tab, setTab] = useState<"configuration" | "list">("configuration");
  const tabs = (
    <div
      role="tablist"
      aria-label="Plugins"
      className="mt-7 flex gap-6 border-b border-border"
    >
      <button
        type="button"
        role="tab"
        aria-selected={tab === "configuration"}
        onClick={() => setTab("configuration")}
        className={cn(
          "min-h-10 border-b-2 px-0 text-sm font-medium",
          tab === "configuration"
            ? "border-foreground text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground",
        )}
      >
        Configuração de plugins
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === "list"}
        onClick={() => setTab("list")}
        className={cn(
          "min-h-10 border-b-2 px-0 text-sm font-medium",
          tab === "list"
            ? "border-foreground text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground",
        )}
      >
        Lista de plugins
      </button>
    </div>
  );
  if (tab === "configuration") {
    return (
      <section aria-labelledby="plugins-heading">
        <h2
          id="plugins-heading"
          className="text-2xl font-semibold tracking-tight"
        >
          Plugins
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Configure os limites e padrões das capacidades instaladas nesta
          sessão.
        </p>
        {tabs}
        <PluginConfiguration
          session={session}
          onUpdate={onUpdatePluginSettings}
        />
      </section>
    );
  }
  return (
    <section aria-labelledby="plugins-heading">
      <h2
        id="plugins-heading"
        className="text-2xl font-semibold tracking-tight"
      >
        Plugins
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
        Inspecione as capacidades instaladas e ajuste a composição da sessão
        atual.
      </p>
      {tabs}
      <label className="relative mt-5 block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <span className="sr-only">Buscar plugins</span>
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          className="h-10 pl-9"
          placeholder="Buscar plugins"
          type="search"
        />
      </label>
      <div className="mt-6">
        <h3 className="font-medium">Plugins da sessão</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Compostos pelo preset {presetTitle} · {pluginCount} plugins
        </p>
      </div>
      <p className="mt-4 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        As alterações valem para as próximas execuções deste chat. As mensagens
        e tool calls anteriores permanecem no histórico.
      </p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {plugins.map((plugin) => {
          const enabled = enabledPluginIds.has(plugin.id);
          const expanded = expandedPluginId === plugin.id;
          return (
            <li
              key={plugin.id}
              className="overflow-hidden rounded-xl border border-border bg-card"
            >
              <div className="flex min-h-20 items-center gap-3 p-4">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onToggleExpanded(plugin.id)}
                  aria-expanded={expanded}
                  aria-controls={`plugin-${plugin.id}`}
                >
                  <p className="truncate font-medium">{plugin.title}</p>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {plugin.description}
                  </p>
                </button>
                <Button
                  type="button"
                  size="sm"
                  variant={enabled ? "secondary" : "outline"}
                  className={cn(
                    "shrink-0",
                    enabled && "text-emerald-700 dark:text-emerald-400",
                  )}
                  onClick={() => onTogglePlugin(plugin.id)}
                  aria-pressed={enabled}
                >
                  {enabled ? "Ativo" : "Inativo"}
                </Button>
                <button
                  type="button"
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onToggleExpanded(plugin.id)}
                  aria-label={`${expanded ? "Ocultar" : "Ver"} detalhes de ${plugin.title}`}
                >
                  {expanded ? (
                    <ChevronUp className="size-4" />
                  ) : (
                    <ChevronDown className="size-4" />
                  )}
                </button>
              </div>
              {expanded ? (
                <div
                  id={`plugin-${plugin.id}`}
                  className="border-t border-border bg-muted/30 px-4 py-3 text-xs leading-5 text-muted-foreground"
                >
                  <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1">
                    <dt>Módulo</dt>
                    <dd className="break-all font-mono text-foreground">
                      {plugin.module}
                    </dd>
                    <dt>Tipo</dt>
                    <dd>{plugin.kind}</dd>
                    <dt>Estado</dt>
                    <dd>
                      {enabled ? "Ativo nesta sessão" : "Inativo nesta sessão"}
                    </dd>
                  </dl>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <PluginCompositionPanel open={tab === "list"} />
      {plugins.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          Nenhum plugin encontrado.
        </p>
      ) : null}
    </section>
  );
}

export function PresetsSection({
  selectedPresetId,
  onSelect,
}: {
  selectedPresetId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section aria-labelledby="presets-heading">
      <h2
        id="presets-heading"
        className="text-2xl font-semibold tracking-tight"
      >
        Agent Presets
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
        Um preset define a composição de plugins, ferramentas e capacidades com
        que o agente desta sessão opera.
      </p>
      <p className="mt-5 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        A troca vale para as próximas execuções. O histórico anterior continua
        associado às ferramentas que já foram usadas.
      </p>
      <h3 className="mt-7 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Integrados
      </h3>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {AGENT_PRESETS.map((preset) => {
          const selected = preset.id === selectedPresetId;
          return (
            <article
              key={preset.id}
              className={cn(
                "flex min-h-52 flex-col rounded-xl border p-5 transition-colors",
                selected
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <h4 className="text-lg font-semibold">{preset.title}</h4>
                {selected ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                    <Check className="size-3" />
                    Em uso
                  </span>
                ) : (
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                    Integrado
                  </span>
                )}
              </div>
              <p className="mt-3 flex-1 text-sm leading-6 text-muted-foreground">
                {preset.description}
              </p>
              <p className="mt-5 font-mono text-xs text-muted-foreground">
                {preset.pluginIds.length} plugins · {preset.id}
              </p>
              <Button
                className="mt-4 w-full"
                variant={selected ? "secondary" : "outline"}
                disabled={selected}
                onClick={() => onSelect(preset.id)}
              >
                {selected ? "Preset atual" : "Usar neste chat"}
              </Button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

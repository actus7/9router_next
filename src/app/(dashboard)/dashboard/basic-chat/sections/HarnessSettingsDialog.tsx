"use client";

import { useMemo, useState } from "react";
import { Bot, BookOpen, Brain, PlugZap, Server, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  DEFAULT_AGENT_PRESET_ID,
  getAgentPreset,
  HARNESS_PLUGINS,
  resolveSessionPlugins,
} from "@/shared/harness/agentPlugins";
import { useMcpServers } from "../hooks/useMcpServers";
import { GeneralSection } from "./HarnessGeneralSection";
import { PluginsSection, PresetsSection } from "./HarnessPluginsSection";
import McpServersSection from "./McpServersSection";
import HarnessSkillsSection from "./HarnessSkillsSection";
import HarnessMemorySection from "./HarnessMemorySection";
import type {
  HarnessSettingsDialogProps,
  HarnessSettingsSection,
} from "./harnessSettingsTypes";

export type { HarnessSettingsSection };


export default function HarnessSettingsDialog(
  props: HarnessSettingsDialogProps,
) {
  const [query, setQuery] = useState("");
  const [expandedPluginId, setExpandedPluginId] = useState<string | null>(null);
  const { session, updateSession, section, onSectionChange } = props;
  const mcp = useMcpServers({ session, updateSession });
  const preset = getAgentPreset(
    session?.agentPresetId ?? DEFAULT_AGENT_PRESET_ID,
  );
  const effectivePlugins = resolveSessionPlugins(
    session?.agentPresetId,
    session?.pluginOverrides,
  );
  const enabledPluginIds = new Set(effectivePlugins.map((plugin) => plugin.id));
  const visiblePlugins = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return normalizedQuery
      ? HARNESS_PLUGINS.filter((plugin) =>
          `${plugin.title} ${plugin.description} ${plugin.id}`
            .toLocaleLowerCase()
            .includes(normalizedQuery),
        )
      : HARNESS_PLUGINS;
  }, [query]);

  const selectPreset = (presetId: string) => {
    if (!session) return;
    updateSession(session.id, (current) => ({
      ...current,
      agentPresetId: presetId,
      pluginOverrides: {},
    }));
  };
  const togglePlugin = (pluginId: string) => {
    if (!session) return;
    updateSession(session.id, (current) => ({
      ...current,
      pluginOverrides: {
        ...current.pluginOverrides,
        [pluginId]: !enabledPluginIds.has(pluginId),
      },
    }));
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        showCloseButton
        className="h-[min(780px,calc(100dvh-2rem))] max-w-[min(1080px,calc(100%-2rem))] grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-[min(1080px,calc(100%-2rem))] sm:grid-cols-[15rem_minmax(0,1fr)] sm:grid-rows-1"
      >
        <aside className="flex min-h-0 flex-col border-b border-border bg-muted/30 p-4 sm:border-b-0 sm:border-r sm:pt-5">
          <DialogHeader className="mb-3 px-2 pr-8 sm:mb-7">
            <DialogTitle className="text-lg">Configurações</DialogTitle>
          </DialogHeader>
          <nav aria-label="Configurações do Harness" className="flex gap-1 overflow-x-auto sm:grid">
            <SettingsNavButton
              active={section === "general"}
              onClick={() => onSectionChange("general")}
              icon={<Settings2 />}
              label="Geral"
            />
            <SettingsNavButton
              active={section === "plugins"}
              onClick={() => onSectionChange("plugins")}
              icon={<PlugZap />}
              label="Plugins"
            />
            <SettingsNavButton
              active={section === "skills"}
              onClick={() => onSectionChange("skills")}
              icon={<BookOpen />}
              label="Skills"
            />
            <SettingsNavButton
              active={section === "memory"}
              onClick={() => onSectionChange("memory")}
              icon={<Brain />}
              label="Aprendizado"
            />
            <SettingsNavButton
              active={section === "mcp"}
              onClick={() => onSectionChange("mcp")}
              icon={<Server />}
              label="MCP"
            />
            <SettingsNavButton
              active={section === "presets"}
              onClick={() => onSectionChange("presets")}
              icon={<Bot />}
              label="Agent Presets"
            />
          </nav>
          <p className="mt-auto hidden px-2 text-xs leading-5 text-muted-foreground sm:block">
            As preferências do chat ficam salvas neste navegador. Gateway,
            catálogo e credenciais permanecem no ModelHub.
          </p>
        </aside>
        <div className="min-h-0 overflow-y-auto p-4 sm:p-8 sm:pr-14">
          {section === "general" ? <GeneralSection {...props} /> : null}
          {section === "plugins" ? (
            <PluginsSection
              presetTitle={preset.title}
              pluginCount={effectivePlugins.length}
              query={query}
              onQueryChange={setQuery}
              plugins={visiblePlugins}
              enabledPluginIds={enabledPluginIds}
              expandedPluginId={expandedPluginId}
              session={session}
              onUpdatePluginSettings={(settings) => {
                if (!session) return;
                updateSession(session.id, (current) => ({
                  ...current,
                  pluginSettings: { ...current.pluginSettings, ...settings },
                }));
              }}
              onToggleExpanded={(pluginId) =>
                setExpandedPluginId((current) =>
                  current === pluginId ? null : pluginId,
                )
              }
              onTogglePlugin={togglePlugin}
            />
          ) : null}
          {section === "skills" ? (
            <HarnessSkillsSection
              session={session}
              updateSession={updateSession}
            />
          ) : null}
          {section === "memory" ? (
            <HarnessMemorySection harnessEvents={props.harnessEvents ?? []} />
          ) : null}
          {section === "mcp" ? (
            <McpServersSection
              servers={session?.mcpServers ?? []}
              name={mcp.name}
              url={mcp.url}
              error={mcp.error}
              connecting={mcp.connecting}
              onNameChange={mcp.setName}
              onUrlChange={mcp.setUrl}
              onAdd={mcp.addServer}
              onToggleServer={mcp.toggleServer}
              onRemoveServer={mcp.removeServer}
              onConnectServer={mcp.connectServer}
              onToggleTool={mcp.toggleTool}
              onSetServerToken={mcp.setServerToken}
            />
          ) : null}
          {section === "presets" ? (
            <PresetsSection
              selectedPresetId={preset.id}
              onSelect={selectPreset}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingsNavButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Button
      variant="ghost"
      className={cn(
        "h-11 shrink-0 justify-start gap-3 px-3 text-sm sm:text-base",
        active && "bg-accent text-accent-foreground",
      )}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      {icon}
      {label}
    </Button>
  );
}

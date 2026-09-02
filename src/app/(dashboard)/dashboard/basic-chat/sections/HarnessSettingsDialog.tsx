"use client";

import { useMemo, useState } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  PlugZap,
  Plus,
  Search,
  Server,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  AGENT_PRESETS,
  DEFAULT_AGENT_PRESET_ID,
  getAgentPreset,
  HARNESS_PLUGINS,
  resolveSessionPlugins,
} from "@/shared/harness/agentPlugins";
import type { ChatSession, HarnessMcpServer, HarnessMcpTool } from "../types";
import { PluginConfiguration } from "./PluginConfiguration";

export type HarnessSettingsSection = "general" | "plugins" | "mcp" | "presets";

interface HarnessSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: HarnessSettingsSection;
  onSectionChange: (section: HarnessSettingsSection) => void;
  session: ChatSession | null;
  updateSession: (
    sessionId: string,
    updater: (session: ChatSession) => ChatSession,
  ) => void;
  systemPrompt: string;
  setSystemPrompt: React.Dispatch<React.SetStateAction<string>>;
  temperature: number;
  setTemperature: React.Dispatch<React.SetStateAction<number>>;
  conversationDisplay: "normal" | "compact";
  setConversationDisplay: React.Dispatch<
    React.SetStateAction<"normal" | "compact">
  >;
  enterBehavior: "queue" | "steer";
  setEnterBehavior: React.Dispatch<React.SetStateAction<"queue" | "steer">>;
}

export default function HarnessSettingsDialog(
  props: HarnessSettingsDialogProps,
) {
  const [query, setQuery] = useState("");
  const [expandedPluginId, setExpandedPluginId] = useState<string | null>(null);
  const [mcpName, setMcpName] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpError, setMcpError] = useState("");
  const [isConnectingMcp, setIsConnectingMcp] = useState(false);
  const { session, updateSession, section, onSectionChange } = props;
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
  const addMcpServer = async () => {
    if (!session || !mcpUrl.trim()) return;
    setIsConnectingMcp(true);
    setMcpError("");
    try {
      const response = await fetch("/api/harness/mcp/discover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: mcpUrl.trim() }),
      });
      const payload = (await response.json().catch(() => null)) as {
        tools?: Array<{
          name?: unknown;
          description?: unknown;
          inputSchema?: unknown;
        }>;
        error?: unknown;
      } | null;
      if (!response.ok || !Array.isArray(payload?.tools))
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : "Não foi possível descobrir as ferramentas MCP.",
        );
      const id = crypto.randomUUID();
      const tools: HarnessMcpTool[] = payload.tools.flatMap((tool, index) =>
        typeof tool.name === "string" && tool.name
          ? [
              {
                name: tool.name,
                description:
                  typeof tool.description === "string"
                    ? tool.description
                    : "MCP tool",
                inputSchema:
                  tool.inputSchema &&
                  typeof tool.inputSchema === "object" &&
                  !Array.isArray(tool.inputSchema)
                    ? (tool.inputSchema as Record<string, unknown>)
                    : { type: "object", properties: {} },
                runtimeName: `mcp_${id.replace(/-/g, "")}_${index}`,
              },
            ]
          : [],
      );
      if (!tools.length)
        throw new Error(
          "O servidor MCP não disponibilizou ferramentas compatíveis.",
        );
      const server: HarnessMcpServer = {
        id,
        name: mcpName.trim() || new URL(mcpUrl.trim()).hostname,
        url: mcpUrl.trim(),
        enabled: true,
        tools,
        validatedAt: new Date().toISOString(),
      };
      updateSession(session.id, (current) => ({
        ...current,
        mcpServers: [...(current.mcpServers ?? []), server],
      }));
      setMcpName("");
      setMcpUrl("");
    } catch (error) {
      setMcpError(
        error instanceof Error
          ? error.message
          : "Não foi possível conectar ao MCP.",
      );
    } finally {
      setIsConnectingMcp(false);
    }
  };
  const updateMcpServer = (
    serverId: string,
    updater: (server: HarnessMcpServer) => HarnessMcpServer,
  ) => {
    if (!session) return;
    updateSession(session.id, (current) => ({
      ...current,
      mcpServers: (current.mcpServers ?? []).map((server) =>
        server.id === serverId ? updater(server) : server,
      ),
    }));
  };
  const removeMcpServer = (serverId: string) => {
    if (!session) return;
    updateSession(session.id, (current) => ({
      ...current,
      mcpServers: (current.mcpServers ?? []).filter(
        (server) => server.id !== serverId,
      ),
    }));
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        showCloseButton
        className="h-[min(780px,calc(100dvh-2rem))] max-w-[min(1080px,calc(100%-2rem))] grid-cols-[15rem_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-[min(1080px,calc(100%-2rem))]"
      >
        <aside className="flex min-h-0 flex-col border-r border-border bg-muted/30 p-4 pt-5">
          <DialogHeader className="mb-7 px-2 pr-8">
            <DialogTitle className="text-lg">Configurações</DialogTitle>
          </DialogHeader>
          <nav aria-label="Configurações do Harness" className="grid gap-1">
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
          <p className="mt-auto px-2 text-xs leading-5 text-muted-foreground">
            As preferências do chat ficam salvas neste navegador. Gateway,
            catálogo e credenciais permanecem no ModelHub.
          </p>
        </aside>
        <div className="min-h-0 overflow-y-auto p-6 pr-11 sm:p-8 sm:pr-14">
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
          {section === "mcp" ? (
            <McpSection
              servers={session?.mcpServers ?? []}
              name={mcpName}
              url={mcpUrl}
              error={mcpError}
              connecting={isConnectingMcp}
              onNameChange={setMcpName}
              onUrlChange={setMcpUrl}
              onAdd={() => void addMcpServer()}
              onToggle={(server) =>
                updateMcpServer(server.id, (current) => ({
                  ...current,
                  enabled: !current.enabled,
                }))
              }
              onRemove={removeMcpServer}
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
        "h-11 justify-start gap-3 px-3 text-base",
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

function GeneralSection({
  systemPrompt,
  setSystemPrompt,
  temperature,
  setTemperature,
  conversationDisplay,
  setConversationDisplay,
  enterBehavior,
  setEnterBehavior,
}: HarnessSettingsDialogProps) {
  return (
    <section aria-labelledby="general-heading" className="max-w-3xl">
      <h2
        id="general-heading"
        className="text-2xl font-semibold tracking-tight"
      >
        Geral
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Preferências que definem como o chat exibe e conduz uma conversa.
      </p>
      <div className="mt-7 divide-y divide-border border-y border-border">
        <SettingRow
          title="Conversation display"
          description="Controla como o conteúdo de processo aparece em turnos concluídos."
        >
          <Select
            value={conversationDisplay}
            onValueChange={(value) =>
              setConversationDisplay(value as "normal" | "compact")
            }
          >
            <SelectTrigger aria-label="Conversation display" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="compact">Compact</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          title="Enter behavior while busy"
          description="Enquanto o agente executa: Queue aguarda; Steer interrompe e envia a nova instrução."
        >
          <Select
            value={enterBehavior}
            onValueChange={(value) =>
              setEnterBehavior(value as "queue" | "steer")
            }
          >
            <SelectTrigger
              aria-label="Enter behavior while busy"
              className="w-36"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="queue">Queue</SelectItem>
              <SelectItem value="steer">Steer</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
      </div>
      <section className="mt-8" aria-labelledby="agent-settings-heading">
        <h3 id="agent-settings-heading" className="text-base font-semibold">
          Instruções do agente
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Aplicadas à próxima execução quando o plugin Agent instructions
          estiver ativo.
        </p>
        <label
          className="mt-4 block text-sm font-medium"
          htmlFor="chat-system-prompt"
        >
          System prompt
        </label>
        <Textarea
          id="chat-system-prompt"
          value={systemPrompt}
          onChange={(event) => setSystemPrompt(event.target.value)}
          placeholder="You are a helpful assistant..."
          rows={4}
          className="mt-2 resize-y"
        />
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <label htmlFor="chat-temperature" className="text-sm font-medium">
            Temperature{" "}
            <span className="text-muted-foreground">
              {temperature.toFixed(1)}
            </span>
          </label>
          <input
            id="chat-temperature"
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={temperature}
            onChange={(event) => setTemperature(Number(event.target.value))}
            className="h-1.5 min-w-48 flex-1 accent-primary"
          />
          <span className="w-8 text-right text-xs text-muted-foreground">
            {temperature.toFixed(1)}
          </span>
        </div>
      </section>
    </section>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-24 flex-col justify-center gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="font-medium">{title}</h3>
        <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </div>
  );
}

function PluginsSection({
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
      {plugins.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          Nenhum plugin encontrado.
        </p>
      ) : null}
    </section>
  );
}

function McpSection({
  servers,
  name,
  url,
  error,
  connecting,
  onNameChange,
  onUrlChange,
  onAdd,
  onToggle,
  onRemove,
}: {
  servers: readonly HarnessMcpServer[];
  name: string;
  url: string;
  error: string;
  connecting: boolean;
  onNameChange: (value: string) => void;
  onUrlChange: (value: string) => void;
  onAdd: () => void;
  onToggle: (server: HarnessMcpServer) => void;
  onRemove: (serverId: string) => void;
}) {
  return (
    <section aria-labelledby="mcp-heading" className="max-w-3xl">
      <h2 id="mcp-heading" className="text-2xl font-semibold tracking-tight">
        MCP servers
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Conecte servidores Model Context Protocol para disponibilizar suas
        ferramentas ao agente deste chat.
      </p>
      <div className="mt-6 rounded-xl border border-border bg-muted/30 p-4">
        <div className="flex items-center gap-2 font-medium">
          <Plus className="size-4" /> Adicionar servidor HTTPS
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          A conexão valida o handshake MCP e descobre as ferramentas antes de
          salvar. Servidores com OAuth ou headers secretos ainda não são
          aceitos.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)_auto]">
          <Input
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="Nome (opcional)"
            aria-label="Nome do servidor MCP"
          />
          <Input
            value={url}
            onChange={(event) => onUrlChange(event.target.value)}
            placeholder="https://mcp.exemplo.com/mcp"
            type="url"
            aria-label="URL do servidor MCP"
          />
          <Button onClick={onAdd} disabled={connecting || !url.trim()}>
            {connecting ? "Conectando…" : "Conectar"}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <div className="mt-7">
        <h3 className="font-medium">Servidores desta sessão</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Ative somente ferramentas que este agente deve poder chamar.
        </p>
        <ul className="mt-4 grid gap-3">
          {servers.map((server) => (
            <li
              key={server.id}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{server.name}</p>
                  <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {server.url}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {server.tools.length} ferramentas descobertas
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={server.enabled ? "secondary" : "outline"}
                    onClick={() => onToggle(server)}
                    aria-pressed={server.enabled}
                  >
                    {server.enabled ? "Ativo" : "Inativo"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => onRemove(server.id)}
                  >
                    Remover
                  </Button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {server.tools.map((tool) => (
                  <span
                    key={tool.runtimeName}
                    className="rounded-md bg-muted px-2 py-1 font-mono text-xs"
                  >
                    {tool.name}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
        {!servers.length ? (
          <p className="mt-6 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            Nenhum servidor MCP conectado nesta sessão.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function PresetsSection({
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

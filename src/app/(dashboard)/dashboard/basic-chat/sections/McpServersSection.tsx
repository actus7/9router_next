"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { HarnessMcpServer } from "../types";

interface McpServerCardProps {
  server: HarnessMcpServer;
  onToggleServer: (server: HarnessMcpServer) => void;
  onRemoveServer: (serverId: string) => void;
  onConnectServer: (server: HarnessMcpServer) => void;
  onToggleTool: (serverId: string, runtimeName: string) => void;
  onSetServerToken: (serverId: string, token: string) => void;
}

function McpServerCard({
  server,
  onToggleServer,
  onRemoveServer,
  onConnectServer,
  onToggleTool,
  onSetServerToken,
}: McpServerCardProps) {
  const [tokenDraft, setTokenDraft] = useState(server.authToken ?? "");
  const isUnconnected = server.tools.length === 0;

  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium">
            {server.name}
            {server.builtin ? (
              <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                Padrão
              </span>
            ) : null}
          </p>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{server.url}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {isUnconnected ? "Ainda não conectado" : `${server.tools.length} ferramentas descobertas`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant={server.enabled ? "secondary" : "outline"} onClick={() => onToggleServer(server)} aria-pressed={server.enabled}>
            {server.enabled ? "Ativo" : "Inativo"}
          </Button>
          {!server.builtin ? (
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => onRemoveServer(server.id)}>
              Remover
            </Button>
          ) : null}
        </div>
      </div>
      {server.builtin ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            value={tokenDraft}
            onChange={(event) => setTokenDraft(event.target.value)}
            onBlur={() => onSetServerToken(server.id, tokenDraft.trim())}
            type="password"
            placeholder="Token (opcional)"
            className="h-8 max-w-64 text-xs"
            aria-label={`Token para ${server.name}`}
          />
          {isUnconnected ? (
            <Button size="sm" variant="outline" onClick={() => onConnectServer(server)}>
              Conectar
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => onConnectServer(server)}>
              Reconectar
            </Button>
          )}
        </div>
      ) : null}
      {server.tools.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {server.tools.map((tool) => {
            const enabled = tool.enabled !== false;
            return (
              <button
                key={tool.runtimeName}
                type="button"
                onClick={() => onToggleTool(server.id, tool.runtimeName)}
                aria-pressed={enabled}
                title={enabled ? "Clique para desativar" : "Clique para ativar"}
                className={`rounded-md px-2 py-1 font-mono text-xs transition-colors ${
                  enabled
                    ? "bg-muted hover:bg-muted/70"
                    : "bg-muted/40 text-muted-foreground/50 line-through hover:bg-muted/60"
                }`}
              >
                {tool.name}
              </button>
            );
          })}
        </div>
      ) : null}
    </li>
  );
}

interface McpServersSectionProps {
  servers: readonly HarnessMcpServer[];
  name: string;
  url: string;
  error: string;
  connecting: boolean;
  onNameChange: (value: string) => void;
  onUrlChange: (value: string) => void;
  onAdd: () => void;
  onToggleServer: (server: HarnessMcpServer) => void;
  onRemoveServer: (serverId: string) => void;
  onConnectServer: (server: HarnessMcpServer) => void;
  onToggleTool: (serverId: string, runtimeName: string) => void;
  onSetServerToken: (serverId: string, token: string) => void;
}

export default function McpServersSection({
  servers,
  name,
  url,
  error,
  connecting,
  onNameChange,
  onUrlChange,
  onAdd,
  onToggleServer,
  onRemoveServer,
  onConnectServer,
  onToggleTool,
  onSetServerToken,
}: McpServersSectionProps) {
  return (
    <section aria-labelledby="mcp-heading" className="max-w-3xl">
      <h2 id="mcp-heading" className="text-2xl font-semibold tracking-tight">
        MCP servers
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Conecte servidores Model Context Protocol para disponibilizar suas ferramentas ao agente deste chat.
      </p>
      <div className="mt-6 rounded-xl border border-border bg-muted/30 p-4">
        <div className="flex items-center gap-2 font-medium">
          <Plus className="size-4" /> Adicionar servidor HTTPS
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          A conexão valida o handshake MCP e descobre as ferramentas antes de salvar. Servidores com OAuth ainda
          não são aceitos — um token via cabeçalho Authorization pode ser adicionado depois de conectar.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)_auto]">
          <Input value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="Nome (opcional)" aria-label="Nome do servidor MCP" />
          <Input value={url} onChange={(event) => onUrlChange(event.target.value)} placeholder="https://mcp.exemplo.com/mcp" type="url" aria-label="URL do servidor MCP" />
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
          Ative somente ferramentas que este agente deve poder chamar. Servidores padrão podem ser desativados,
          mas não removidos. Clique numa ferramenta para ligar/desligar individualmente.
        </p>
        <ul className="mt-4 grid gap-3">
          {servers.map((server) => (
            <McpServerCard
              key={server.id}
              server={server}
              onToggleServer={onToggleServer}
              onRemoveServer={onRemoveServer}
              onConnectServer={onConnectServer}
              onToggleTool={onToggleTool}
              onSetServerToken={onSetServerToken}
            />
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

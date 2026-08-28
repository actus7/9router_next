"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import Button from "@/shared/components/Button";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, X } from "lucide-react";

const REGISTRY_ENDPOINT = "/api/cli-tools/cowork-mcp-registry";
const TOOLS_ENDPOINT = "/api/cli-tools/cowork-mcp-tools";

interface McpServer {
  url: string;
  slug?: string;
  name?: string;
  title?: string;
  description?: string;
  iconUrl?: string;
  oauth?: boolean;
  transport?: string;
  toolCount?: number;
  toolNames?: string[];
}

interface ToolCacheEntry {
  tools: { name: string }[];
  requiresAuth?: boolean;
  error?: string;
}

interface McpMarketplaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd?: (server: {
    name: string;
    title?: string;
    description?: string;
    url: string;
    transport?: string;
    oauth?: boolean;
    toolNames: string[];
  }) => void;
  addedNames?: string[];
}

export default function McpMarketplaceModal({ isOpen, onClose, onAdd, addedNames = [] }: McpMarketplaceModalProps) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [search, setSearch] = useState<string>("");
  const [filter, setFilter] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [expandedUrl, setExpandedUrl] = useState<string | null>(null);
  const [toolsCache, setToolsCache] = useState<Record<string, ToolCacheEntry>>({});
  const [toolsLoading, setToolsLoading] = useState<Record<string, boolean>>({});
  const [toolSelection, setToolSelection] = useState<Record<string, Record<string, boolean>>>({});

  useEffect(() => {
    if (!isOpen) return;
    if (servers.length > 0) return;
    setLoading(true);
    fetch(REGISTRY_ENDPOINT)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setServers(d.servers || []);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [isOpen]);

  const addedSet = useMemo(() => new Set(addedNames), [addedNames]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return servers.filter((s) => {
      if (filter === "authless" && s.oauth) return false;
      if (filter === "oauth" && !s.oauth) return false;
      if (!q) return true;
      return (
        (s.title || "").toLowerCase().includes(q) ||
        (s.description || "").toLowerCase().includes(q) ||
        (s.name || "").toLowerCase().includes(q)
      );
    });
  }, [servers, search, filter]);

  const fetchTools = async (server: McpServer) => {
    if (toolsCache[server.url]) return;
    setToolsLoading((p) => ({ ...p, [server.url]: true }));
    try {
      const r = await fetch(TOOLS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: server.url }),
      });
      const d = await r.json();
      const tools = d.tools || [];
      const fallback = Array.isArray(server.toolNames) ? server.toolNames : [];
      const toolNames = tools.length > 0 ? tools.map((t: { name: string }) => t.name) : fallback;
      setToolsCache((p) => ({ ...p, [server.url]: { tools, requiresAuth: !!d.requiresAuth, error: d.error } }));
      // Default: all checked
      setToolSelection((p) => ({ ...p, [server.url]: Object.fromEntries(toolNames.map((t: string) => [t, true])) }));
    } catch (e: unknown) {
      setToolsCache((p) => ({ ...p, [server.url]: { tools: [], error: e instanceof Error ? e.message : String(e) } }));
    } finally {
      setToolsLoading((p) => ({ ...p, [server.url]: false }));
    }
  };

  const expandServer = (server: McpServer) => {
    if (expandedUrl === server.url) {
      setExpandedUrl(null);
      return;
    }
    setExpandedUrl(server.url);
    fetchTools(server);
  };

  const toggleTool = (url: string, tool: string) => {
    setToolSelection((prev) => ({ ...prev, [url]: { ...prev[url], [tool]: !prev[url]?.[tool] } }));
  };

  const setAllTools = (url: string, value: boolean) => {
    const sel = toolSelection[url] || {};
    setToolSelection((prev) => ({ ...prev, [url]: Object.fromEntries(Object.keys(sel).map((t) => [t, value])) }));
  };

  const confirmAdd = (server: McpServer) => {
    const sel = toolSelection[server.url] || {};
    const enabled = Object.keys(sel).filter((t) => sel[t]);
    onAdd?.({
      name: server.slug || server.name || "",
      title: server.title,
      description: server.description,
      url: server.url,
      transport: server.transport,
      oauth: server.oauth,
      toolNames: enabled,
    });
    setExpandedUrl(null);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "bg-surface border border-border-subtle rounded-[14px]",
          "shadow-[var(--shadow-elev)] ring-0 gap-0 p-0",
          "max-w-lg"
        )}
      >
        <div className="flex items-center justify-between p-2 border-b border-border-subtle">
          <DialogTitle className="text-lg font-semibold text-text-main ml-2">
            Explorar Marketplace MCP
          </DialogTitle>
          <Button onClick={onClose} aria-label="Fechar" variant="ghost" size="icon-sm">
            <X className="size-5" />
          </Button>
        </div>
        <div className="p-6 max-h-[calc(85vh-100px)] overflow-y-auto custom-scrollbar">
          <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar por nome ou descrição..."
            className="flex-1 px-2 py-1.5 text-xs"
          />
          <Select value={filter} onValueChange={(v) => setFilter(v ?? "all")}>
            <SelectTrigger className="px-2 py-1.5 bg-surface rounded text-xs">
              <SelectValue placeholder="Filtrar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="authless">Sem autenticação</SelectItem>
              <SelectItem value="oauth">OAuth</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {error && (
          <div className="px-2 py-1.5 rounded text-xs bg-red-500/10 text-red-600">{error}</div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-text-muted text-xs py-4 justify-center">
            <Loader2 className="size-5" />
            <span>Carregando registro...</span>
          </div>
        )}

        {!loading && (
          <div className="flex flex-col gap-1 max-h-[60vh] overflow-y-auto">
            {filtered.length === 0 && (
              <div className="text-center text-xs text-text-muted py-6">Nenhum servidor corresponde ao filtro</div>
            )}
            {filtered.map((s) => {
              const added = addedSet.has(s.slug || s.name || "");
              const expanded = expandedUrl === s.url;
              const cache = toolsCache[s.url];
              const isLoadingTools = toolsLoading[s.url];
              const sel = toolSelection[s.url] || {};
              const toolKeys = Object.keys(sel);
              const selectedCount = Object.values(sel).filter(Boolean).length;
              return (
                <div key={s.url} className="rounded border border-transparent hover:border-border">
                  <div className="flex items-start gap-2 px-2 py-2 hover:bg-surface-2/50">
                    {s.iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.iconUrl} alt="" className="size-7 rounded shrink-0 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} loading="lazy" decoding="async" />
                    ) : (
                      <div className="size-7 rounded bg-surface shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-xs">{s.title}</span>
                        {s.oauth ? (
                          <span className="px-1 py-0.5 text-[9px] rounded bg-amber-500/10 text-amber-600">OAuth</span>
                        ) : (
                          <span className="px-1 py-0.5 text-[9px] rounded bg-green-500/10 text-green-600">Sem autenticação</span>
                        )}
                        {s.toolCount && s.toolCount > 0 && (
                          <span className="text-[10px] text-text-muted">{s.toolCount} ferramentas</span>
                        )}
                      </div>
                      {s.description && (
                        <p className="text-[10px] text-text-muted line-clamp-2 mt-0.5">{s.description}</p>
                      )}
                    </div>
                    <Button
                      onClick={() => added ? null : expandServer(s)}
                      disabled={added}
                      variant={added ? "ghost" : expanded ? "outline" : "default"}
                      size="sm"
                      className={`shrink-0 px-2 py-1 rounded text-[10px] font-medium ${
                        added
                          ? "bg-green-500/10 text-green-600 cursor-default"
                          : ""
                      }`}
                    >
                      {added ? "Adicionado" : expanded ? "Cancelar" : "+ Adicionar"}
                    </Button>
                  </div>
                  {expanded && (
                    <div className="px-3 py-2 bg-surface/40 border-t border-border flex flex-col gap-2">
                      {isLoadingTools && (
                        <div className="flex items-center gap-2 text-text-muted text-[10px] py-1">
                          <Loader2 className="size-4" />
                          <span>Verificando ferramentas do servidor...</span>
                        </div>
                      )}
                      {!isLoadingTools && cache?.requiresAuth && (
                        <p className="text-[10px] text-amber-600 bg-amber-500/10 px-2 py-1 rounded">
                          🔐 OAuth necessário. Adicione agora e autentique após Aplicar; a lista de ferramentas será descoberta após a primeira conexão.
                        </p>
                      )}
                      {!isLoadingTools && cache?.error && !cache?.requiresAuth && (
                        <p className="text-[10px] text-red-600 bg-red-500/10 px-2 py-1 rounded">Falha na verificação: {cache.error}</p>
                      )}
                      {!isLoadingTools && toolKeys.length === 0 && !cache?.requiresAuth && !cache?.error && (
                        <p className="text-[10px] text-text-muted">Nenhuma ferramenta anunciada pelo servidor.</p>
                      )}
                      {!isLoadingTools && toolKeys.length > 0 && (
                        <>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-text-muted">{selectedCount}/{toolKeys.length} ferramentas habilitadas</span>
                            <div className="flex gap-1">
                              <Button onClick={() => setAllTools(s.url, true)} variant="ghost" size="xs" className="text-[10px] text-primary hover:underline">Todas</Button>
                              <span className="text-[10px] text-text-muted">·</span>
                              <Button onClick={() => setAllTools(s.url, false)} variant="ghost" size="xs" className="text-[10px] text-primary hover:underline">Nenhuma</Button>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto">
                            {toolKeys.map((t) => (
                              <Label key={t} className="gap-1.5 text-[10px] cursor-pointer hover:bg-surface-2/50 px-1 rounded">
                                <Checkbox
                                  checked={!!sel[t]}
                                  onCheckedChange={() => toggleTool(s.url, t)}
                                  className="size-3"
                                />
                                <span className="truncate">{t}</span>
                              </Label>
                            ))}
                          </div>
                        </>
                      )}
                      <Button
                        onClick={() => confirmAdd(s)}
                        variant="default"
                        size="sm"
                        className="self-end px-2 py-1 rounded text-[10px] font-medium"
                      >
                        ✓ Confirmar Adição
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="text-[10px] text-text-muted text-right">
          {filtered.length} de {servers.length} servidores
        </div>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Loader2, X } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { useMcpMarketplace, type McpServer } from "./useMcpMarketplace";
import { McpServerCard } from "./McpServerCard";
import { McpToolPanel } from "./McpToolPanel";

interface McpMarketplaceModalProps {
  isOpen: boolean; onClose: () => void;
  onAdd?: (server: { name: string; title?: string; description?: string; url: string; transport?: string; oauth?: boolean; toolNames: string[] }) => void;
  addedNames?: string[];
}

export default function McpMarketplaceModal({ isOpen, onClose, onAdd, addedNames = [] }: McpMarketplaceModalProps) {
  const m = useMcpMarketplace(isOpen, addedNames);

  const confirmAdd = (server: McpServer) => {
    const sel = m.toolSelection[server.url] || {};
    onAdd?.({ name: server.slug || server.name || "", title: server.title, description: server.description, url: server.url, transport: server.transport, oauth: server.oauth, toolNames: Object.keys(sel).filter((t) => sel[t]) });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className={cn("bg-surface border border-border-subtle rounded-[14px]", "shadow-[var(--shadow-elev)] ring-0 gap-0 p-0", "max-w-lg")}>
        <div className="flex items-center justify-between p-2 border-b border-border-subtle">
          <DialogTitle className="text-lg font-semibold text-text-main ml-2">{translate("Browse MCP Marketplace") || "Browse MCP Marketplace"}</DialogTitle>
          <Button onClick={onClose} aria-label={translate("Close") || "Close"} variant="ghost" size="icon-sm"><X className="size-5" /></Button>
        </div>
        <div className="p-6 max-h-[calc(85vh-100px)] overflow-y-auto custom-scrollbar">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Input type="text" value={m.search} onChange={(e) => m.setSearch(e.target.value)} placeholder={translate("Search by name or description...") || "Search by name or description..."} className="flex-1 px-2 py-1.5 text-xs" />
              <Select value={m.filter} onValueChange={(v) => m.setFilter(v ?? "all")}>
                <SelectTrigger className="px-2 py-1.5 bg-surface rounded text-xs"><SelectValue placeholder={translate("Filter") || "Filter"} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{translate("All") || "All"}</SelectItem>
                  <SelectItem value="authless">{translate("Authless") || "Authless"}</SelectItem>
                  <SelectItem value="oauth">OAuth</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {m.error && <div className="px-2 py-1.5 rounded text-xs bg-red-500/10 text-red-600">{m.error}</div>}
            {m.loading && <div className="flex items-center gap-2 text-text-muted text-xs py-4 justify-center"><Loader2 className="size-5" /><span>{translate("Loading registry...") || "Loading registry..."}</span></div>}
            {!m.loading && (
              <div className="flex flex-col gap-1 max-h-[60vh] overflow-y-auto">
                {m.filtered.length === 0 && <div className="text-center text-xs text-text-muted py-6">{translate("No servers match filter") || "No servers match filter"}</div>}
                {m.filtered.map((s) => {
                  const added = m.addedSet.has(s.slug || s.name || "");
                  const expanded = m.expandedUrl === s.url;
                  const sel = m.toolSelection[s.url] || {};
                  const toolKeys = Object.keys(sel);
                  return (
                    <div key={s.url} className="rounded border border-transparent hover:border-border">
                      <McpServerCard server={s} added={added} expanded={expanded} onExpand={m.expandServer} />
                      {expanded && <McpToolPanel server={s} cache={m.toolsCache[s.url]} isLoading={!!m.toolsLoading[s.url]} sel={sel} toolKeys={toolKeys} selectedCount={Object.values(sel).filter(Boolean).length} toggleTool={m.toggleTool} setAllTools={m.setAllTools} confirmAdd={confirmAdd} />}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="text-[10px] text-text-muted text-right">{m.filtered.length} {translate("of") || "of"} {m.servers.length} {translate("servers") || "servers"}</div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

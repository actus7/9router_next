"use client";

import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { translate } from "@/i18n/runtime";
import type { McpServer, ToolCacheEntry } from "./useMcpMarketplace";

interface McpToolPanelProps {
  server: McpServer;
  cache: ToolCacheEntry | undefined;
  isLoading: boolean;
  sel: Record<string, boolean>;
  toolKeys: string[];
  selectedCount: number;
  toggleTool: (url: string, tool: string) => void;
  setAllTools: (url: string, value: boolean) => void;
  confirmAdd: (server: McpServer) => void;
}

export function McpToolPanel({ server, cache, isLoading, sel, toolKeys, selectedCount, toggleTool, setAllTools, confirmAdd }: McpToolPanelProps) {
  return (
    <div className="px-3 py-2 bg-surface/40 border-t border-border flex flex-col gap-2">
      {isLoading && (
        <div className="flex items-center gap-2 text-text-muted text-[10px] py-1">
          <Loader2 className="size-4" />
          <span>{translate("Probing server for tools...") || "Probing server for tools..."}</span>
        </div>
      )}
      {!isLoading && cache?.requiresAuth && (
        <p className="text-[10px] text-amber-600 bg-amber-500/10 px-2 py-1 rounded">
          🔐 {translate("OAuth required. Add now and authenticate after Apply; the tool list will be discovered after the first connection.") || "OAuth required. Add now and authenticate after Apply; the tool list will be discovered after the first connection."}
        </p>
      )}
      {!isLoading && cache?.error && !cache?.requiresAuth && (
        <p className="text-[10px] text-red-600 bg-red-500/10 px-2 py-1 rounded">{translate("Verification failed") || "Verification failed"}: {cache.error}</p>
      )}
      {!isLoading && toolKeys.length === 0 && !cache?.requiresAuth && !cache?.error && (
        <p className="text-[10px] text-text-muted">{translate("No tools advertised by server.") || "No tools advertised by server."}</p>
      )}
      {!isLoading && toolKeys.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-muted">{selectedCount}/{toolKeys.length} {translate("tools enabled") || "tools enabled"}</span>
            <div className="flex gap-1">
              <Button onClick={() => setAllTools(server.url, true)} variant="ghost" size="xs" className="text-[10px] text-primary hover:underline">{translate("All") || "All"}</Button>
              <span className="text-[10px] text-text-muted">·</span>
              <Button onClick={() => setAllTools(server.url, false)} variant="ghost" size="xs" className="text-[10px] text-primary hover:underline">{translate("None") || "None"}</Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto">
            {toolKeys.map((t) => (
              <Label key={t} className="gap-1.5 text-[10px] cursor-pointer hover:bg-surface-2/50 px-1 rounded">
                <Checkbox checked={!!sel[t]} onCheckedChange={() => toggleTool(server.url, t)} className="size-3" />
                <span className="truncate">{t}</span>
              </Label>
            ))}
          </div>
        </>
      )}
      <Button onClick={() => confirmAdd(server)} variant="default" size="sm" className="self-end px-2 py-1 rounded text-[10px] font-medium">
        ✓ {translate("Confirm Add") || "Confirm Add"}
      </Button>
    </div>
  );
}

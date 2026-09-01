"use client";

import Button from "@/shared/components/Button";
import { translate } from "@/i18n/runtime";
import type { McpServer } from "./useMcpMarketplace";

interface McpServerCardProps {
  server: McpServer;
  added: boolean;
  expanded: boolean;
  onExpand: (server: McpServer) => void;
}

export function McpServerCard({ server, added, expanded, onExpand }: McpServerCardProps) {
  return (
    <div className="flex items-start gap-2 px-2 py-2 hover:bg-surface-2/50">
      {server.iconUrl ? (
        <img src={server.iconUrl} alt="" className="size-7 rounded shrink-0 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} loading="lazy" decoding="async" />
      ) : (
        <div className="size-7 rounded bg-surface shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-medium text-xs">{server.title}</span>
          {server.oauth ? (
            <span className="px-1 py-0.5 text-[9px] rounded bg-amber-500/10 text-amber-600">OAuth</span>
          ) : (
            <span className="px-1 py-0.5 text-[9px] rounded bg-green-500/10 text-green-600">{translate("Authless") || "Authless"}</span>
          )}
          {server.toolCount && server.toolCount > 0 && (
            <span className="text-[10px] text-text-muted">{server.toolCount} {translate("Tools") || "Tools"}</span>
          )}
        </div>
        {server.description && (
          <p className="text-[10px] text-text-muted line-clamp-2 mt-0.5">{server.description}</p>
        )}
      </div>
      <Button
        onClick={() => added ? null : onExpand(server)}
        disabled={added}
        variant={added ? "ghost" : expanded ? "outline" : "default"}
        size="sm"
        className={`shrink-0 px-2 py-1 rounded text-[10px] font-medium ${added ? "bg-green-500/10 text-green-600 cursor-default" : ""}`}
      >
        {added ? translate("Added") || "Added" : expanded ? translate("Cancel") || "Cancel" : `+ ${translate("Add") || "Add"}`}
      </Button>
    </div>
  );
}

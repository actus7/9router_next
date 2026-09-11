"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { translate } from "@/i18n/runtime";
import type { RunState } from "../hooks/useRunIndicators";
import RunBadge from "./RunBadge";
import { Plus, Search } from "lucide-react";
import { formatRelativeTime } from "../chatFormatUtils";
import type { UseChatSessionsReturn } from "../hooks/useChatSessions";

interface ChatMobileHistoryMenuProps {
  /** Owned by the page: one poller feeds every list that shows these. */
  runIndicators: Map<string, RunState>;
  sessionsHook: UseChatSessionsReturn;
}

export default function ChatMobileHistoryMenu({ sessionsHook, runIndicators }: ChatMobileHistoryMenuProps) {
  const {
    historyOpen, historyMenuRef, handleNewChat, activeModel, historySearch, setHistorySearch,
    groupedSessionItems, activeSessionId, handleSelectSession,
  } = sessionsHook;

  if (!historyOpen) return null;

  return (
    <div ref={historyMenuRef} className="absolute right-4 top-[52px] z-20 flex max-h-[70vh] w-[min(340px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl md:hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <h2 className="text-sm font-semibold text-foreground">{translate("Sessions") || "Sessions"}</h2>
        <Button variant="ghost" size="icon-sm" type="button" onClick={handleNewChat} disabled={!activeModel} aria-label={translate("New chat") || "New chat"} className="size-7">
          <Plus className="size-3.5" />
        </Button>
      </div>
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="relative">
          <Search aria-hidden="true" className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input value={historySearch} onChange={(e) => setHistorySearch(e.target.value)} placeholder={translate("Search...") || "Search..."} className="h-7 pl-7 text-xs" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar">
        {groupedSessionItems.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">{translate("No conversations yet.") || "No conversations yet."}</p>
        ) : groupedSessionItems.map((group) => (
          <div key={group.label}>
            <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</p>
            {group.items.map((session) => (
              <button key={session.id} type="button" onClick={() => handleSelectSession(session.id)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-muted ${session.id === activeSessionId ? "bg-muted" : ""}`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{session.title}</p>
                  <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    {formatRelativeTime(session.updatedAt)}
                    {runIndicators.get(session.id) ? <RunBadge state={runIndicators.get(session.id)!} /> : null}
                  </p>
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

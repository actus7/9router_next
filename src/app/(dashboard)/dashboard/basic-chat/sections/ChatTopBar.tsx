"use client";

import { Button } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import {
  ChevronDown, MessageSquare, PanelRightClose, PanelRightOpen, Plus, Settings2, Terminal,
} from "lucide-react";
import type { UseChatSessionsReturn } from "../hooks/useChatSessions";
import type { UseHarnessEventsReturn } from "../hooks/useHarnessEvents";

interface ChatTopBarProps {
  sessionsHook: UseChatSessionsReturn;
  harnessHook: UseHarnessEventsReturn;
}

export default function ChatTopBar({ sessionsHook, harnessHook }: ChatTopBarProps) {
  const {
    sidebarOpen, setSidebarOpen, setModelMenuOpen, activeModel, activeProject, setShowSettings,
    handleNewChat, setHistoryOpen,
  } = sessionsHook;
  const { showRunJournal, setShowRunJournal } = harnessHook;

  const modelLabel = activeModel ? activeModel.name : (translate("Select model") || "Select model");
  const modelSubLabel = activeModel ? activeModel.requestModel : (translate("Choose from connected providers") || "Choose from connected providers");

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          type="button"
          onClick={() => setSidebarOpen((value) => !value)}
          aria-label={sidebarOpen ? (translate("Hide sidebar") || "Hide sidebar") : (translate("Show sidebar") || "Show sidebar")}
          aria-pressed={sidebarOpen}
          className="hidden size-8 md:flex"
        >
          {sidebarOpen ? <PanelRightClose className="size-3.5" /> : <PanelRightOpen className="size-3.5" />}
        </Button>
        <button
            type="button"
            onClick={() => setModelMenuOpen(true)}
            aria-label={translate("Select model") || "Select model"}
            className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-muted"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-foreground truncate max-w-[200px]">{modelLabel}</span>
              <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
            </div>
            <p className="truncate text-[11px] text-muted-foreground max-w-[240px]">{modelSubLabel}</p>
          </div>
        </button>
        {activeProject ? (
          <span className="hidden max-w-40 truncate rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground lg:inline">{activeProject.title}</span>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="icon-sm" type="button" onClick={() => setShowSettings((v) => !v)} aria-label={translate("Chat settings") || "Chat settings"} className="size-8">
          <Settings2 className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" type="button" onClick={() => setShowRunJournal((v) => !v)} aria-label="Run journal" aria-pressed={showRunJournal} className="size-8">
          <Terminal className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" type="button" aria-label={translate("New chat") || "New chat"} onClick={handleNewChat} disabled={!activeModel} className="size-7 md:hidden">
          <Plus className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" type="button" onClick={() => setHistoryOpen((v) => !v)} aria-label={translate("History") || "History"} className="size-8 md:hidden">
          <MessageSquare className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

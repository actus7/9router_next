"use client";

import { Button } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import {
  MessageSquare, PanelRightClose, PanelRightOpen, Plus, Settings2, Terminal,
} from "lucide-react";
import type { UseChatSessionsReturn } from "../hooks/useChatSessions";
import type { UseHarnessEventsReturn } from "../hooks/useHarnessEvents";

interface ChatTopBarProps {
  sessionsHook: UseChatSessionsReturn;
  harnessHook: UseHarnessEventsReturn;
}

export default function ChatTopBar({ sessionsHook, harnessHook }: ChatTopBarProps) {
  const {
    sidebarOpen, setSidebarOpen, activeModel, activeProject, setShowSettings,
    handleNewChat, setHistoryOpen, providerGroups, activeProviderId, activeModelId,
    activeProviderGroup, handleSelectProvider, handleSelectModel,
  } = sessionsHook;
  const { showRunJournal, setShowRunJournal } = harnessHook;

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <label className="sr-only" htmlFor="chat-provider">{translate("Provider") || "Provider"}</label>
          <select
            id="chat-provider"
            value={activeProviderId}
            onChange={(event) => handleSelectProvider(event.target.value)}
            className="h-9 max-w-40 rounded-lg border border-border bg-card px-2 text-xs font-medium text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            {providerGroups.map((provider) => (
              <option key={provider.providerId} value={provider.providerId}>{provider.providerName}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="chat-model">{translate("Model") || "Model"}</label>
          <select
            id="chat-model"
            value={activeModelId}
            onChange={(event) => handleSelectModel(event.target.value)}
            disabled={!activeProviderGroup?.models.length}
            className="h-9 min-w-0 max-w-60 rounded-lg border border-border bg-card px-2 text-xs font-medium text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {activeProviderGroup?.models.map((model) => (
              <option key={model.id} value={model.id}>{model.name}</option>
            ))}
          </select>
        </div>
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

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { translate } from "@/i18n/runtime";
import {
  ChevronDown,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  SlidersHorizontal,
  Terminal,
} from "lucide-react";
import type { UseChatSessionsReturn } from "../hooks/useChatSessions";
import type { UseHarnessEventsReturn } from "../hooks/useHarnessEvents";
import ChatModelPickerModal from "./ChatModelPickerModal";
import IconActionButton from "./IconActionButton";

interface ChatTopBarProps {
  sessionsHook: UseChatSessionsReturn;
  harnessHook: UseHarnessEventsReturn;
  onOpenPlugins: () => void;
}

export default function ChatTopBar({
  sessionsHook,
  harnessHook,
  onOpenPlugins,
}: ChatTopBarProps) {
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const {
    sidebarOpen,
    setSidebarOpen,
    activeModel,
    activeProject,
    handleNewChat,
    setHistoryOpen,
    providerGroups,
    activeProviderId,
    activeModelId,
    handleSelectModel,
  } = sessionsHook;
  const { showRunJournal, setShowRunJournal } = harnessHook;

  return (
    <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => setModelPickerOpen(true)}
          disabled={providerGroups.length === 0}
          className="h-8 max-w-72 justify-between gap-2 px-3 text-xs font-medium"
        >
          <span className="min-w-0 truncate">
            {activeModel?.name || translate("Choose model") || "Choose model"}
          </span>
          <ChevronDown className="size-4 shrink-0" />
        </Button>
        {activeProject ? (
          <span className="hidden max-w-40 truncate rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground lg:inline">
            {activeProject.title}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-1">
        <IconActionButton
          tooltip="Configurações do Harness"
          onClick={onOpenPlugins}
          className="size-8"
        >
          <SlidersHorizontal className="size-4" />
        </IconActionButton>
        <IconActionButton
          tooltip={translate("Run journal") || "Run journal"}
          onClick={() => setShowRunJournal((v) => !v)}
          aria-pressed={showRunJournal}
          className="size-8"
        >
          <Terminal className="size-4" />
        </IconActionButton>
        <IconActionButton
          tooltip={translate("New chat") || "New chat"}
          onClick={handleNewChat}
          disabled={!activeModel}
          className="size-8"
        >
          <Plus className="size-4" />
        </IconActionButton>
        <IconActionButton
          tooltip={
            sidebarOpen
              ? translate("Hide sidebar") || "Hide sidebar"
              : translate("Show sidebar") || "Show sidebar"
          }
          onClick={() => setSidebarOpen((value) => !value)}
          aria-pressed={sidebarOpen}
          className="hidden size-8 md:flex"
        >
          {sidebarOpen ? (
            <PanelRightClose className="size-4" />
          ) : (
            <PanelRightOpen className="size-4" />
          )}
        </IconActionButton>
        <IconActionButton
          tooltip={translate("History") || "History"}
          onClick={() => setHistoryOpen((v) => !v)}
          data-history-toggle=""
          className="size-8 md:hidden"
        >
          <MessageSquare className="size-4" />
        </IconActionButton>
      </div>
      <ChatModelPickerModal
        isOpen={modelPickerOpen}
        onClose={() => setModelPickerOpen(false)}
        onSelect={handleSelectModel}
        providerGroups={providerGroups}
        activeProviderId={activeProviderId}
        activeModelId={activeModelId}
      />
    </div>
  );
}

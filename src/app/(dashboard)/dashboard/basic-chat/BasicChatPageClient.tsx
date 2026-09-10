"use client";

import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { useChatModels } from "./hooks/useChatModels";
import { useHarnessCatalog } from "./hooks/useHarnessCatalog";
import { useSkillsCatalog } from "./hooks/useSkillsCatalog";
import {
  useChatSessions,
  type UseChatSessionsReturn,
} from "./hooks/useChatSessions";
import { useHarnessEvents } from "./hooks/useHarnessEvents";
import { useSendMessage } from "./hooks/useSendMessage";
import { useDurableRunRecovery } from "./hooks/useDurableRunRecovery";
import { useRunIndicators } from "./hooks/useRunIndicators";
import ChatSidebar from "./sections/ChatSidebar";
import ChatTopBar from "./sections/ChatTopBar";
import ChatRunJournal from "./sections/ChatRunJournal";
import ChatMobileHistoryMenu from "./sections/ChatMobileHistoryMenu";
import ChatMessageList from "./sections/ChatMessageList";
import ChatComposer from "./sections/ChatComposer";
import ChatLiveRunStatus from "./sections/ChatLiveRunStatus";
import HarnessSettingsDialog, {
  type HarnessSettingsSection,
} from "./sections/HarnessSettingsDialog";

export default function BasicChatPageClient() {
  const [harnessSettingsOpen, setHarnessSettingsOpen] = useState(false);
  const [harnessSettingsSection, setHarnessSettingsSection] =
    useState<HarnessSettingsSection>("general");
  // Adopts the server's composed plugin catalogue. Until it arrives the bundle
  // defaults are active, so the chat is usable from the first paint.
  useHarnessCatalog();
  useSkillsCatalog();
  const modelsHook = useChatModels();
  const sessionsHook = useChatSessions({
    providerGroups: modelsHook.providerGroups,
    loadingData: modelsHook.loadingData,
    modelIndex: modelsHook.modelIndex,
  });
  const harnessHook = useHarnessEvents(sessionsHook.activeSessionId);
  // One poller for the page. Both conversation lists render these badges, and
  // both are mounted at all times, so a hook call inside each would poll twice
  // forever — usually once for a list nobody can see.
  const runIndicators = useRunIndicators();
  // Picks up answers that finished on the server while this tab was closed.
  useDurableRunRecovery({
    activeSessionId: sessionsHook.activeSessionId,
    isReady: sessionsHook.isHydrated,
    updateSession: sessionsHook.updateSession,
  });
  const sendHook = useSendMessage({
    activeModel: sessionsHook.activeModel,
    activeProviderGroup: sessionsHook.activeProviderGroup,
    activeSessionId: sessionsHook.activeSessionId,
    setActiveSessionId: sessionsHook.setActiveSessionId,
    sessions: sessionsHook.sessions,
    setSessions: sessionsHook.setSessions,
    updateSession: sessionsHook.updateSession,
    ensureSessionForModel: sessionsHook.ensureSessionForModel,
    draft: sessionsHook.draft,
    setDraft: sessionsHook.setDraft,
    attachments: sessionsHook.attachments,
    setAttachments: sessionsHook.setAttachments,
    systemPrompt: sessionsHook.systemPrompt,
    temperature: sessionsHook.temperature,
    reasoningEffort: sessionsHook.reasoningEffort,
    enterBehavior: sessionsHook.enterBehavior,
    apiKey: sessionsHook.apiKey,
    recordHarnessEvent: harnessHook.recordHarnessEvent,
  });

  // Starting a new chat must also clear any in-flight streaming UI state,
  // which now lives in useSendMessage rather than useChatSessions.
  const chatSessions: UseChatSessionsReturn = {
    ...sessionsHook,
    handleNewChat: () => {
      sessionsHook.handleNewChat();
      sendHook.resetStream();
    },
  };

  return (
    <div className="relative flex-1 flex h-full min-h-0 min-w-0 bg-background text-foreground overflow-hidden">
      <ChatSidebar
        sessionsHook={chatSessions}
        onExport={sendHook.handleExportConversation}
        runIndicators={runIndicators}
      />

      <div className="relative order-1 flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <ChatTopBar
          sessionsHook={chatSessions}
          harnessHook={harnessHook}
          onOpenPlugins={() => {
            setHarnessSettingsSection("general");
            setHarnessSettingsOpen(true);
          }}
        />
        <ChatRunJournal harnessHook={harnessHook} />
        <ChatMobileHistoryMenu sessionsHook={chatSessions} runIndicators={runIndicators} />

        {/*
          * `providerLoadError` was computed and then never rendered anywhere.
          * When /api/providers fails, or no provider has an eligible model, the
          * composer is disabled by `!activeModel` and the screen says nothing —
          * which reads as the product being broken rather than unconfigured.
          */}
        {sendHook.chatError || modelsHook.providerLoadError ? (
          <div className="mx-6 mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <p className="text-xs leading-5">{sendHook.chatError || modelsHook.providerLoadError}</p>
            </div>
          </div>
        ) : null}

        <div className="flex flex-1 flex-col min-h-0">
          <ChatMessageList sessionsHook={chatSessions} sendHook={sendHook} />
          <ChatLiveRunStatus
            active={sendHook.isSending}
            activities={sendHook.liveActivities}
          />
          <ChatComposer
            sessionsHook={chatSessions}
            sendHook={sendHook}
            loadingData={modelsHook.loadingData}
          />
        </div>
      </div>
      <HarnessSettingsDialog
        open={harnessSettingsOpen}
        onOpenChange={setHarnessSettingsOpen}
        section={harnessSettingsSection}
        onSectionChange={setHarnessSettingsSection}
        session={sessionsHook.currentSession}
        updateSession={sessionsHook.updateSession}
        systemPrompt={sessionsHook.systemPrompt}
        setSystemPrompt={sessionsHook.setSystemPrompt}
        temperature={sessionsHook.temperature}
        setTemperature={sessionsHook.setTemperature}
        conversationDisplay={sessionsHook.conversationDisplay}
        setConversationDisplay={sessionsHook.setConversationDisplay}
        enterBehavior={sessionsHook.enterBehavior}
        setEnterBehavior={sessionsHook.setEnterBehavior}
        harnessEvents={harnessHook.harnessEvents}
      />
    </div>
  );
}

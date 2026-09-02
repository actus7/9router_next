"use client";

import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { useChatModels } from "./hooks/useChatModels";
import {
  useChatSessions,
  type UseChatSessionsReturn,
} from "./hooks/useChatSessions";
import { useHarnessEvents } from "./hooks/useHarnessEvents";
import { useSendMessage } from "./hooks/useSendMessage";
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
  const modelsHook = useChatModels();
  const sessionsHook = useChatSessions({
    providerGroups: modelsHook.providerGroups,
    loadingData: modelsHook.loadingData,
    modelIndex: modelsHook.modelIndex,
  });
  const harnessHook = useHarnessEvents(sessionsHook.activeSessionId);
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
        <ChatMobileHistoryMenu sessionsHook={chatSessions} />

        {sendHook.chatError ? (
          <div className="mx-6 mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <p className="text-xs leading-5">{sendHook.chatError}</p>
            </div>
          </div>
        ) : null}

        <div className="flex flex-1 flex-col min-h-0">
          <ChatMessageList sessionsHook={sessionsHook} sendHook={sendHook} />
          <ChatLiveRunStatus
            active={sendHook.isSending}
            activities={sendHook.liveActivities}
          />
          <ChatComposer
            sessionsHook={sessionsHook}
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
      />
    </div>
  );
}

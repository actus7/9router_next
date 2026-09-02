"use client";

import { AlertCircle } from "lucide-react";
import { useChatModels } from "./hooks/useChatModels";
import { useChatSessions, type UseChatSessionsReturn } from "./hooks/useChatSessions";
import { useHarnessEvents } from "./hooks/useHarnessEvents";
import { useSendMessage } from "./hooks/useSendMessage";
import ChatSidebar from "./sections/ChatSidebar";
import ChatTopBar from "./sections/ChatTopBar";
import ChatSettingsPanel from "./sections/ChatSettingsPanel";
import ChatRunJournal from "./sections/ChatRunJournal";
import ChatMobileHistoryMenu from "./sections/ChatMobileHistoryMenu";
import ChatMessageList from "./sections/ChatMessageList";
import ChatComposer from "./sections/ChatComposer";
import ChatLiveRunStatus from "./sections/ChatLiveRunStatus";

export default function BasicChatPageClient() {
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
    apiKey: sessionsHook.apiKey,
    recordHarnessEvent: harnessHook.recordHarnessEvent,
    setBlockedModelIds: modelsHook.setBlockedModelIds,
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
      <ChatSidebar sessionsHook={chatSessions} onExport={sendHook.handleExportConversation} />

      <div className="relative order-1 flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <ChatTopBar sessionsHook={chatSessions} harnessHook={harnessHook} />
        <ChatSettingsPanel sessionsHook={sessionsHook} />
        <ChatRunJournal harnessHook={harnessHook} />
        <ChatMobileHistoryMenu sessionsHook={chatSessions} />

        {sendHook.chatError ? (
          <div className="mx-4 mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
            <div className="flex items-start gap-2">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <p className="text-xs leading-5">{sendHook.chatError}</p>
            </div>
          </div>
        ) : null}

        <div className="flex flex-1 flex-col min-h-0">
          <ChatMessageList sessionsHook={sessionsHook} sendHook={sendHook} />
          <ChatLiveRunStatus active={sendHook.isSending} activities={sendHook.liveActivities} />
          <ChatComposer sessionsHook={sessionsHook} sendHook={sendHook} loadingData={modelsHook.loadingData} />
        </div>
      </div>
    </div>
  );
}

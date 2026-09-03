"use client";

import { useEffect, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { translate } from "@/i18n/runtime";
import {
  ArrowUp,
  Check,
  CornerDownLeft,
  ListTree,
  LogIn,
  LogOut,
  Monitor,
  Paperclip,
  StopCircle,
  X,
} from "lucide-react";
import {
  getPuterAuthStatus,
  isPuterBrowserModel,
  signInToPuter,
  signOutOfPuter,
} from "../puterBrowser";
import { getRuntimeToolDefinitions } from "@/shared/harness/agentPlugins";
import type { UseChatSessionsReturn } from "../hooks/useChatSessions";
import type { UseSendMessageReturn } from "../hooks/useSendMessage";
import ChatCommandsMenu from "./ChatCommandsMenu";
import ChatQueueBar from "./ChatQueueBar";
import ChatUsageBar from "./ChatUsageBar";
import { estimateContextUsage } from "./contextUsageEstimate";

interface ChatComposerProps {
  sessionsHook: UseChatSessionsReturn;
  sendHook: UseSendMessageReturn;
  loadingData: boolean;
}

export default function ChatComposer({
  sessionsHook,
  sendHook,
  loadingData,
}: ChatComposerProps) {
  const {
    draft,
    setDraft,
    attachments,
    attachmentNotice,
    setAttachmentNotice,
    removeAttachment,
    fileInputRef,
    handleAttachFiles,
    activeModel,
    currentSession,
    updateSession,
    reasoningEffort,
    setReasoningEffort,
    systemPrompt,
    conversationDisplay,
    setConversationDisplay,
    enterBehavior,
    setEnterBehavior,
  } = sessionsHook;
  const {
    handleKeyDown,
    isSending,
    handleStop,
    canSend,
    canQueue,
    queuedMessages,
    sendMessage,
    queueMessage,
    cancelQueuedMessage,
    moveQueuedMessage,
    handleExportConversation,
  } = sendHook;

  const contextUsage = estimateContextUsage(
    currentSession?.messages ?? [],
    systemPrompt,
    JSON.stringify(
      getRuntimeToolDefinitions(
        currentSession?.agentPresetId,
        currentSession?.pluginOverrides,
      ),
    ),
  );

  const isPuterModel = !!activeModel && isPuterBrowserModel(activeModel);
  const [puterAuth, setPuterAuth] = useState<{
    isSignedIn: boolean;
    username?: string;
  } | null>(null);
  const [puterAuthBusy, setPuterAuthBusy] = useState(false);

  useEffect(() => {
    if (!isPuterModel) {
      setPuterAuth(null);
      return;
    }
    let cancelled = false;
    getPuterAuthStatus()
      .then((status) => {
        if (!cancelled) setPuterAuth(status);
      })
      .catch(() => {
        if (!cancelled) setPuterAuth({ isSignedIn: false });
      });
    return () => {
      cancelled = true;
    };
  }, [isPuterModel]);

  const handlePuterAuthToggle = async () => {
    setPuterAuthBusy(true);
    try {
      if (puterAuth?.isSignedIn) await signOutOfPuter();
      else await signInToPuter();
      setPuterAuth(await getPuterAuthStatus());
    } catch {
      // User closed the Puter dialog or the SDK is unreachable; leave state as-is.
    } finally {
      setPuterAuthBusy(false);
    }
  };

  return (
    <div className="shrink-0 border-t border-border bg-background/95 pt-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <ChatQueueBar items={queuedMessages} onCancel={cancelQueuedMessage} onMove={moveQueuedMessage} />
      {attachmentNotice ? (
        <div className="mx-auto mb-3 flex w-full max-w-3xl items-center justify-between gap-3 px-6">
          <p role="status" className="text-xs text-destructive">{attachmentNotice}</p>
          <button
            type="button"
            onClick={() => setAttachmentNotice("")}
            aria-label={translate("Dismiss") || "Dismiss"}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}
      {attachments.length > 0 && (
        <div className="mx-auto mb-4 flex w-full max-w-3xl flex-wrap gap-2 px-6">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3.5 py-2"
            >
              <span className="text-xs text-card-foreground max-w-[10rem] truncate">
                {attachment.name}
              </span>
              <button
                type="button"
                onClick={() => removeAttachment(attachment.id)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Remove"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mx-auto w-full max-w-4xl px-6 pb-5">
        <div className="rounded-2xl border border-border bg-card px-4 pt-4 pb-3 shadow-md transition-shadow focus-within:border-ring focus-within:shadow-[var(--shadow-focus)]">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={translate("Message to AI") || "Message to AI"}
            rows={1}
            className="resize-none border-0 bg-transparent px-2 text-[15px] leading-7 text-foreground placeholder:text-muted-foreground custom-scrollbar max-h-[25vh] focus-visible:ring-0 focus-visible:ring-offset-0"
          />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border/70 pt-3">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <ChatCommandsMenu
                disabled={!activeModel || loadingData}
                onExport={handleExportConversation}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                aria-label={translate("Attach image") || "Attach image"}
                onClick={() => fileInputRef.current?.click()}
                disabled={!activeModel || loadingData}
                className="size-8 text-muted-foreground hover:text-foreground"
              >
                <Paperclip className="size-4" />
              </Button>
              <Input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleAttachFiles}
              />
              <Popover>
                <PopoverTrigger
                  className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Selecionar esforço de raciocínio"
                >
                  Esforço: {reasoningEffort === "low"
                    ? "Baixo"
                    : reasoningEffort === "medium"
                      ? "Médio"
                      : reasoningEffort === "high"
                        ? "Alto"
                        : "Padrão"}
                </PopoverTrigger>
                <PopoverContent className="w-48 p-1" align="start">
                  <p className="px-2 pt-1 pb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Esforço de raciocínio
                  </p>
                  {(["low", "medium", "high"] as const).map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setReasoningEffort(level)}
                      className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs capitalize hover:bg-muted ${reasoningEffort === level ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                    >
                      {level === "low"
                        ? "Baixo"
                        : level === "medium"
                          ? "Médio"
                          : "Alto"}
                      {reasoningEffort === level ? (
                        <Check className="size-3.5" aria-hidden="true" />
                      ) : null}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setReasoningEffort(null)}
                    className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-muted ${reasoningEffort === null ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                  >
                    Padrão do modelo
                    {reasoningEffort === null ? (
                      <Check className="size-3.5" aria-hidden="true" />
                    ) : null}
                  </button>
                </PopoverContent>
              </Popover>
              <Popover>
                <PopoverTrigger className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground">
                  {contextUsage.percentUsed < 1
                    ? "<1"
                    : contextUsage.percentUsed.toFixed(0)}
                  % {translate("of context used") || "of context used"}
                </PopoverTrigger>
                <PopoverContent className="w-64" align="start">
                  <p className="mb-2 text-xs font-medium">
                    {contextUsage.percentUsed.toFixed(0)}%{" "}
                    {translate("of context used") || "of context used"} — ~
                    {(contextUsage.totalTokens / 1000).toFixed(1)}K /{" "}
                    {(contextUsage.contextWindowTokens / 1000).toFixed(0)}K
                  </p>
                  <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary"
                      style={{
                        width: `${Math.min(100, contextUsage.percentUsed)}%`,
                      }}
                    />
                  </div>
                  <dl className="space-y-1 text-[11px]">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">
                        {translate("System prompt") || "System prompt"}
                      </dt>
                      <dd>
                        ~{(contextUsage.systemPromptTokens / 1000).toFixed(1)}K
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">
                        {translate("Tools") || "Tools"}
                      </dt>
                      <dd>~{(contextUsage.toolsTokens / 1000).toFixed(1)}K</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">
                        {translate("Messages") || "Messages"}
                      </dt>
                      <dd>
                        ~{(contextUsage.messagesTokens / 1000).toFixed(1)}K
                      </dd>
                    </div>
                  </dl>
                </PopoverContent>
              </Popover>
              <Button
                variant={
                  currentSession?.mode === "plan" ? "secondary" : "ghost"
                }
                size="sm"
                type="button"
                disabled={!currentSession || isSending}
                aria-pressed={currentSession?.mode === "plan"}
                onClick={() =>
                  currentSession &&
                  updateSession(currentSession.id, (session) => ({
                    ...session,
                    mode: session.mode === "plan" ? "agent" : "plan",
                  }))
                }
                className="h-7 gap-1 px-2.5 text-[11px]"
              >
                <ListTree className="size-3" />
                {currentSession?.mode === "plan" ? "Plano" : "Agente"}
              </Button>
              <Popover>
                <PopoverTrigger
                  className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Conversation display"
                >
                  <Monitor className="size-3" />
                  <span className="hidden sm:inline">
                    {conversationDisplay === "normal"
                      ? "Detalhada"
                      : "Compacta"}
                  </span>
                </PopoverTrigger>
                <PopoverContent className="w-52 p-1" align="start">
                  <p className="px-2 py-1.5 text-xs font-medium">
                    Detalhes de execução
                  </p>
                  <button
                    type="button"
                    onClick={() => setConversationDisplay("compact")}
                    className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-xs hover:bg-muted"
                  >
                    <span>
                      <span className="block font-medium">Compacta</span>
                      <span className="block text-muted-foreground">
                        Resume tools concluídas; preserva erros e mídia.
                      </span>
                    </span>
                    {conversationDisplay === "compact" ? (
                      <Check className="size-3.5" />
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConversationDisplay("normal")}
                    className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-xs hover:bg-muted"
                  >
                    <span>
                      <span className="block font-medium">Detalhada</span>
                      <span className="block text-muted-foreground">
                        Exibe as chamadas e retornos das ferramentas.
                      </span>
                    </span>
                    {conversationDisplay === "normal" ? (
                      <Check className="size-3.5" />
                    ) : null}
                  </button>
                </PopoverContent>
              </Popover>
              <Popover>
                <PopoverTrigger
                  className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Enter behavior while busy"
                >
                  <CornerDownLeft className="size-3" />
                  <span className="hidden sm:inline">
                    {enterBehavior === "queue" ? "Fila" : "Direcionar"}
                  </span>
                </PopoverTrigger>
                <PopoverContent className="w-60 p-1" align="start">
                  <p className="px-2 py-1.5 text-xs font-medium">
                    Enter durante execução
                  </p>
                  <button
                    type="button"
                    onClick={() => setEnterBehavior("queue")}
                    className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-xs hover:bg-muted"
                  >
                    <span>
                      <span className="block font-medium">Fila</span>
                      <span className="block text-muted-foreground">
                        Envia ao terminar a resposta.
                      </span>
                    </span>
                    {enterBehavior === "queue" ? (
                      <Check className="size-3.5" />
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEnterBehavior("steer")}
                    className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-xs hover:bg-muted"
                  >
                    <span>
                      <span className="block font-medium">Direcionar</span>
                      <span className="block text-muted-foreground">
                        Interrompe e envia a nova instrução.
                      </span>
                    </span>
                    {enterBehavior === "steer" ? (
                      <Check className="size-3.5" />
                    ) : null}
                  </button>
                </PopoverContent>
              </Popover>
              {isPuterModel && puterAuth && (
                <button
                  type="button"
                  onClick={() => void handlePuterAuthToggle()}
                  disabled={puterAuthBusy}
                  className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {puterAuth.isSignedIn ? (
                    <>
                      <LogOut className="size-3" />
                      {puterAuth.username ||
                        translate("Sign out of Puter") ||
                        "Sair da Puter"}
                    </>
                  ) : (
                    <>
                      <LogIn className="size-3" />
                      {translate("Sign in to Puter") || "Entrar na Puter"}
                    </>
                  )}
                </button>
              )}
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-2">
              {isSending && (
                <>
                  <button
                    type="button"
                    onClick={queueMessage}
                    disabled={!canQueue}
                    className="rounded-full border border-border px-3.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-60"
                  >
                    {queuedMessages.length > 0 ? `Na fila (${queuedMessages.length})` : "Enviar depois"}
                  </button>
                  <button
                    type="button"
                    aria-label={
                      translate("Stop generation") || "Stop generation"
                    }
                    onClick={handleStop}
                    className="flex items-center gap-1.5 rounded-full bg-destructive text-destructive-foreground px-3.5 py-1.5 text-xs font-medium animate-pulse-stop hover:bg-destructive/90 transition-colors"
                  >
                    <StopCircle className="size-3.5" />
                    {translate("Stop") || "Stop"}
                  </button>
                </>
              )}
              <Button
                variant="default"
                size="icon-sm"
                aria-label={translate("Send") || "Send"}
                onClick={() => void sendMessage()}
                disabled={!canSend}
                className="size-8"
              >
                <ArrowUp className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
      <ChatUsageBar messages={currentSession?.messages ?? []} />
    </div>
  );
}

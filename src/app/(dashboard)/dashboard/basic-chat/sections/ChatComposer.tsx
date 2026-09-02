"use client";

import { useEffect, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { translate } from "@/i18n/runtime";
import { ArrowUp, ListTree, LogIn, LogOut, Paperclip, StopCircle, X } from "lucide-react";
import { getPuterAuthStatus, isPuterBrowserModel, signInToPuter, signOutOfPuter } from "../puterBrowser";
import type { UseChatSessionsReturn } from "../hooks/useChatSessions";
import type { UseSendMessageReturn } from "../hooks/useSendMessage";

interface ChatComposerProps {
  sessionsHook: UseChatSessionsReturn;
  sendHook: UseSendMessageReturn;
  loadingData: boolean;
}

export default function ChatComposer({ sessionsHook, sendHook, loadingData }: ChatComposerProps) {
  const {
    draft, setDraft, attachments, removeAttachment, fileInputRef, handleAttachFiles, activeModel, currentSession, updateSession,
  } = sessionsHook;
  const { handleKeyDown, isSending, handleStop, canSend, canQueue, queuedMessage, sendMessage, queueMessage } = sendHook;

  const isPuterModel = !!activeModel && isPuterBrowserModel(activeModel);
  const [puterAuth, setPuterAuth] = useState<{ isSignedIn: boolean; username?: string } | null>(null);
  const [puterAuthBusy, setPuterAuthBusy] = useState(false);

  useEffect(() => {
    if (!isPuterModel) { setPuterAuth(null); return; }
    let cancelled = false;
    getPuterAuthStatus()
      .then((status) => { if (!cancelled) setPuterAuth(status); })
      .catch(() => { if (!cancelled) setPuterAuth({ isSignedIn: false }); });
    return () => { cancelled = true; };
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
      {attachments.length > 0 && (
        <div className="mx-auto mb-4 flex w-full max-w-3xl flex-wrap gap-2 px-6">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3.5 py-2">
              <span className="text-xs text-card-foreground max-w-[10rem] truncate">{attachment.name}</span>
              <button type="button" onClick={() => removeAttachment(attachment.id)} className="text-muted-foreground hover:text-foreground" aria-label="Remove">
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

          <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/70 pt-3">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon-sm" type="button" aria-label={translate("Attach image") || "Attach image"} onClick={() => fileInputRef.current?.click()} disabled={!activeModel || loadingData} className="size-8 text-muted-foreground hover:text-foreground">
                <Paperclip className="size-4" />
              </Button>
              <Input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleAttachFiles} />
              <span className="text-[11px] font-medium text-muted-foreground truncate max-w-[140px]">
                {activeModel ? activeModel.name : (translate("No model") || "No model")}
              </span>
              <Button
                variant={currentSession?.mode === "plan" ? "secondary" : "ghost"}
                size="sm"
                type="button"
                disabled={!currentSession || isSending}
                aria-pressed={currentSession?.mode === "plan"}
                onClick={() => currentSession && updateSession(currentSession.id, (session) => ({ ...session, mode: session.mode === "plan" ? "agent" : "plan" }))}
                className="h-7 gap-1 px-2.5 text-[11px]"
              >
                <ListTree className="size-3" />
                {currentSession?.mode === "plan" ? "Plano" : "Agente"}
              </Button>
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
                      {puterAuth.username || translate("Sign out of Puter") || "Sair da Puter"}
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

            <div className="flex items-center gap-2">
              {isSending && (
                <>
                  <button
                    type="button"
                    onClick={queueMessage}
                    disabled={!canQueue}
                    className="rounded-full border border-border px-3.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-60"
                  >
                    {queuedMessage ? "Na fila" : "Enviar depois"}
                  </button>
                  <button
                    type="button"
                    aria-label={translate("Stop generation") || "Stop generation"}
                    onClick={handleStop}
                    className="flex items-center gap-1.5 rounded-full bg-destructive text-destructive-foreground px-3.5 py-1.5 text-xs font-medium animate-pulse-stop hover:bg-destructive/90 transition-colors"
                  >
                    <StopCircle className="size-3.5" />
                    {translate("Stop") || "Stop"}
                  </button>
                </>
              )}
              <Button variant="default" size="icon-sm" aria-label={translate("Send") || "Send"} onClick={() => void sendMessage()} disabled={!canSend} className="size-8">
                <ArrowUp className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

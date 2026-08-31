"use client";

import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/shared/components";
import { Input } from "@/components/ui/input";
import { translate } from "@/i18n/runtime";
import { ArrowUp, Paperclip, StopCircle, X } from "lucide-react";
import type { UseChatSessionsReturn } from "../hooks/useChatSessions";
import type { UseSendMessageReturn } from "../hooks/useSendMessage";

interface ChatComposerProps {
  sessionsHook: UseChatSessionsReturn;
  sendHook: UseSendMessageReturn;
  loadingData: boolean;
}

export default function ChatComposer({ sessionsHook, sendHook, loadingData }: ChatComposerProps) {
  const {
    draft, setDraft, attachments, removeAttachment, fileInputRef, handleAttachFiles, activeModel,
  } = sessionsHook;
  const { handleKeyDown, isSending, handleStop, canSend, sendMessage } = sendHook;

  return (
    <div className="shrink-0 border-t border-border bg-background/95 pt-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      {attachments.length > 0 && (
        <div className="mx-auto mb-3 flex w-full max-w-3xl flex-wrap gap-2 px-4">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1.5">
              <span className="text-xs text-card-foreground max-w-[10rem] truncate">{attachment.name}</span>
              <button type="button" onClick={() => removeAttachment(attachment.id)} className="text-muted-foreground hover:text-foreground" aria-label="Remove">
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mx-auto w-full max-w-4xl px-4 pb-4">
        <div className="rounded-2xl border border-border bg-card px-3 pt-3 pb-2 shadow-md transition-shadow focus-within:border-ring focus-within:shadow-[var(--shadow-focus)]">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={translate("Message to AI") || "Message to AI"}
            rows={1}
            className="resize-none border-0 bg-transparent px-2 text-[15px] leading-6 text-foreground placeholder:text-muted-foreground custom-scrollbar max-h-[25vh] focus-visible:ring-0 focus-visible:ring-offset-0"
          />

          <div className="mt-2 flex items-center justify-between gap-3 border-t border-border/70 pt-2">
            <div className="flex items-center gap-1.5">
              <Button variant="ghost" size="icon-sm" type="button" aria-label={translate("Attach image") || "Attach image"} onClick={() => fileInputRef.current?.click()} disabled={!activeModel || loadingData} className="size-7 text-muted-foreground hover:text-foreground">
                <Paperclip className="size-4" />
              </Button>
              <Input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleAttachFiles} />
              <span className="text-[11px] font-medium text-muted-foreground truncate max-w-[140px]">
                {activeModel ? activeModel.name : (translate("No model") || "No model")}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              {isSending && (
                <button
                  type="button"
                  aria-label={translate("Stop generation") || "Stop generation"}
                  onClick={handleStop}
                  className="flex items-center gap-1.5 rounded-full bg-destructive text-destructive-foreground px-3 py-1.5 text-xs font-medium animate-pulse-stop hover:bg-destructive/90 transition-colors"
                >
                  <StopCircle className="size-3.5" />
                  {translate("Stop") || "Stop"}
                </button>
              )}
              <Button variant="default" size="icon-sm" aria-label={translate("Send") || "Send"} onClick={() => void sendMessage()} disabled={!canSend} className="size-7">
                <ArrowUp className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

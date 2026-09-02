"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { DynamicMedia } from "@/components/ui/dynamic-media";
import { translate } from "@/i18n/runtime";
import SafeMarkdown from "@/shared/components/SafeMarkdown";
import {
  ArrowDown, Check, Copy, Hash, MessageSquare, RefreshCw, ThumbsDown, ThumbsUp, Wrench,
} from "lucide-react";
import { textValue } from "../chatFormatUtils";
import type { UseChatSessionsReturn } from "../hooks/useChatSessions";
import type { UseSendMessageReturn } from "../hooks/useSendMessage";

const STARTER_SUGGESTIONS = ["Resuma este projeto em tópicos.", "Compare provedores para o meu caso.", "Me ajude a diagnosticar um erro 500."];

interface ChatMessageListProps {
  sessionsHook: UseChatSessionsReturn;
  sendHook: UseSendMessageReturn;
}

export default function ChatMessageList({ sessionsHook, sendHook }: ChatMessageListProps) {
  const { currentMessages, activeModel, activeSessionId, setDraft } = sessionsHook;
  const {
    streamingMessageId, streamingText, copiedMessageId, handleCopyMessage, handleFeedback, handleRetryMessage,
  } = sendHook;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const previousLastMessageIdRef = useRef("");
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  // Tool result messages exist in the model transcript, but their associated
  // assistant card is the readable UI representation for people.
  const visibleMessages = currentMessages.filter((message) => message.role !== "tool");

  const isNearBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return true;
    return container.scrollHeight - container.scrollTop - container.clientHeight < 72;
  }, []);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "auto") => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior });
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
  }, []);

  const handleScroll = useCallback(() => {
    const nearBottom = isNearBottom();
    stickToBottomRef.current = nearBottom;
    setShowJumpToLatest(!nearBottom);
  }, [isNearBottom]);

  // A conversation is always opened at its latest message. This is a layout
  // effect so the composer and message list settle before the user sees it.
  useLayoutEffect(() => {
    stickToBottomRef.current = true;
    previousLastMessageIdRef.current = currentMessages.at(-1)?.id || "";
    const frame = requestAnimationFrame(() => scrollToLatest());
    return () => cancelAnimationFrame(frame);
  }, [activeSessionId, currentMessages, scrollToLatest]);

  // New turns are an intentional navigation to the latest content. Streaming
  // follows only while the user remains at the bottom; reading older messages
  // must never be interrupted by incoming tokens.
  useEffect(() => {
    const lastMessageId = currentMessages.at(-1)?.id || "";
    const isNewTurn = Boolean(lastMessageId && lastMessageId !== previousLastMessageIdRef.current);
    previousLastMessageIdRef.current = lastMessageId;
    if (isNewTurn) stickToBottomRef.current = true;
    if (!stickToBottomRef.current) return;
    const frame = requestAnimationFrame(() => scrollToLatest());
    return () => cancelAnimationFrame(frame);
  }, [currentMessages, streamingMessageId, streamingText, scrollToLatest]);

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={scrollContainerRef} onScroll={handleScroll} className="h-full overflow-y-auto py-6 custom-scrollbar">
      {visibleMessages.length === 0 ? (
        <div className="flex min-h-[50vh] items-center justify-center px-6 text-center">
          <div className="w-full max-w-lg flex flex-col items-center gap-5">
            <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm">
              <MessageSquare className="size-6" />
            </div>
            <div className="flex flex-col items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">{translate("Start a conversation") || "Start a conversation"}</h2>
              <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
                {translate("Select a model and start chatting with any AI from your connected providers.") || "Select a model and start chatting with any AI from your connected providers."}
              </p>
            </div>
            <div className="grid w-full gap-2 text-left sm:grid-cols-3">
              {STARTER_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setDraft(translate(suggestion) || suggestion)}
                  className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm leading-5 text-foreground shadow-sm transition-all hover:border-primary/40 hover:bg-accent hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {translate(suggestion) || suggestion}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6">
        {visibleMessages.map((message) => {
          const isUser = message.role === "user";
          const isAssistant = message.role === "assistant";
          const isStreaming = isAssistant && message.id === streamingMessageId && message.status === "streaming";
          const isError = message.status === "error";
          const content = textValue(message.content) || (isAssistant ? streamingText : "");

          return (
            <div key={message.id} className={`group/msg flex w-full chat-message-enter ${isUser ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[min(90%,46rem)] ${isUser ? "rounded-2xl bg-primary px-5 py-3.5 text-primary-foreground shadow-sm" : "text-foreground"}`}>
                {/* Message header */}
                <div className="mb-2 flex items-center gap-2">
                  <span className={`text-xs font-semibold ${isUser ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                    {isUser ? (translate("You") || "You") : message.modelName || activeModel?.name || (translate("Assistant") || "Assistant")}
                  </span>
                  {isError && (
                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Error</Badge>
                  )}
                </div>

                {/* Attachments */}
                {message.attachments?.length ? (
                  <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {message.attachments.map((attachment) => (
                      <a key={attachment.id} href={attachment.dataUrl} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-border bg-muted/40">
                        <DynamicMedia src={attachment.dataUrl} alt={attachment.name} className="h-24 w-full object-cover" />
                      </a>
                    ))}
                  </div>
                ) : null}

                {/* Message content */}
                {isAssistant ? (
                  <SafeMarkdown source={content} className="prose-chat text-[15px] leading-7" />
                ) : (
                  <div className="whitespace-pre-wrap break-words text-[15px] leading-7">
                    {content}
                  </div>
                )}

                {/* Streaming cursor */}
                {isAssistant && isStreaming && !streamingText && (
                  <span className="inline-block animate-pulse text-primary">▋</span>
                )}

                {/* Tool calls */}
                {message.toolCalls && message.toolCalls.length > 0 && (
                  <div className="mt-3 flex flex-col gap-1.5">
                    {message.toolCalls.map((tc) => (
                      <div key={tc.id} className="rounded-lg border border-border bg-muted/40 px-3.5 py-2.5">
                        <div className="flex items-center gap-2">
                          <Wrench className="size-3.5 text-muted-foreground" />
                          <span className="text-xs font-medium text-foreground">{tc.name}</span>
                          <Badge variant={tc.status === "done" ? "default" : tc.status === "error" ? "destructive" : "secondary"} className="text-[9px] px-1.5 py-0">
                            {tc.status || "pending"}
                          </Badge>
                        </div>
                        {tc.result && (
                          <pre className="mt-1.5 text-[11px] text-muted-foreground overflow-x-auto max-h-32 overflow-y-auto">
                            {tc.result.slice(0, 500)}{tc.result.length > 500 ? "..." : ""}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Message actions */}
                {isAssistant && !isStreaming && content && (
                  <div className="mt-3.5 flex items-center gap-1.5 opacity-0 transition-opacity group-focus-within/msg:opacity-100 group-hover/msg:opacity-100">
                    <button
                      type="button"
                      onClick={() => handleCopyMessage(message.id, content)}
                      aria-label={translate("Copy response") || "Copy response"}
                      className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      {copiedMessageId === message.id ? (
                        <><Check className="size-3.5" /> Copied</>
                      ) : (
                        <><Copy className="size-3.5" /> Copy</>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFeedback(message.id, "up")}
                      aria-label={translate("Good response") || "Good response"}
                      className={`flex items-center rounded-md px-2 py-1.5 transition-colors ${message.feedback === "up" ? "text-success-foreground bg-success" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                    >
                      <ThumbsUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFeedback(message.id, "down")}
                      aria-label={translate("Poor response") || "Poor response"}
                      className={`flex items-center rounded-md px-2 py-1.5 transition-colors ${message.feedback === "down" ? "text-destructive-foreground bg-destructive" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                    >
                      <ThumbsDown className="size-3.5" />
                    </button>
                    {!isError && (
                      <button
                        type="button"
                        onClick={() => handleRetryMessage(message.id)}
                        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      >
                        <RefreshCw className="size-3.5" /> {translate("Regenerate") || "Regenerate"}
                      </button>
                    )}
                    {isError && (
                      <button
                        type="button"
                        onClick={() => handleRetryMessage(message.id)}
                        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      >
                        <RefreshCw className="size-3.5" /> Retry
                      </button>
                    )}
                    {/* Token usage */}
                    {message.tokenUsage && (
                      <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground/60">
                        <Hash className="size-2.5" />
                        {message.tokenUsage.total_tokens || (message.tokenUsage.prompt_tokens || 0) + (message.tokenUsage.completion_tokens || 0)} tokens
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      </div>
      {showJumpToLatest && visibleMessages.length > 0 ? (
        <button
          type="button"
          onClick={() => scrollToLatest("smooth")}
          className="absolute bottom-4 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-xs font-medium text-foreground shadow-md transition-all hover:bg-muted hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowDown className="size-3.5" />
          {translate("Latest messages") || "Latest messages"}
        </button>
      ) : null}
    </div>
  );
}


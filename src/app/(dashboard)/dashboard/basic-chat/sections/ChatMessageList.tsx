"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import {
  DynamicMedia,
  isSupportedMediaSource,
} from "@/components/ui/dynamic-media";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { translate } from "@/i18n/runtime";
import SafeMarkdown from "@/shared/components/SafeMarkdown";
import {
  ArrowDown,
  Check,
  Copy,
  Hash,
  MessageSquare,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  Wrench,
  Zap,
} from "lucide-react";
import { textValue } from "../chatFormatUtils";
import type { UseChatSessionsReturn } from "../hooks/useChatSessions";
import type { UseSendMessageReturn } from "../hooks/useSendMessage";
import type { ToolCall } from "../types";

const STARTER_SUGGESTIONS = [
  "Resuma este projeto em tópicos.",
  "Compare provedores para o meu caso.",
  "Me ajude a diagnosticar um erro 500.",
];

type ToolMedia = { kind: "image" | "audio" | "video"; url: string };

/** Parses a completed media-tool result into a renderable image/audio/video, or null. */
function extractToolMedia(tc: ToolCall): ToolMedia | null {
  if (!tc.result || tc.status !== "done") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(tc.result);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  if (tc.name === "generate_image") {
    const data = obj.data as Array<Record<string, unknown>> | undefined;
    const url = data?.[0]?.url;
    if (typeof url === "string" && isSupportedMediaSource(url))
      return { kind: "image", url };
    const b64 = data?.[0]?.b64_json;
    if (typeof b64 === "string" && b64)
      return { kind: "image", url: `data:image/png;base64,${b64}` };
    return null;
  }
  if (
    tc.name === "text_to_speech" &&
    typeof obj.audioUrl === "string" &&
    obj.audioUrl.startsWith("data:audio/")
  ) {
    return { kind: "audio", url: obj.audioUrl };
  }
  if (
    tc.name === "generate_video" &&
    obj.ok === true &&
    typeof obj.url === "string" &&
    isSupportedMediaSource(obj.url)
  ) {
    return { kind: "video", url: obj.url };
  }
  return null;
}

interface ChatMessageListProps {
  sessionsHook: UseChatSessionsReturn;
  sendHook: UseSendMessageReturn;
}

export default function ChatMessageList({
  sessionsHook,
  sendHook,
}: ChatMessageListProps) {
  const {
    currentMessages,
    activeModel,
    activeSessionId,
    setDraft,
    conversationDisplay,
  } = sessionsHook;
  const compact = conversationDisplay === "compact";
  const {
    streamingMessageId,
    streamingText,
    copiedMessageId,
    handleCopyMessage,
    handleFeedback,
    handleRetryMessage,
  } = sendHook;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const previousLastMessageIdRef = useRef("");
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  // Tool result messages exist in the model transcript, but their associated
  // assistant card is the readable UI representation for people.
  const visibleMessages = currentMessages.filter(
    (message) => message.role !== "tool",
  );

  const isNearBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return true;
    return (
      container.scrollHeight - container.scrollTop - container.clientHeight < 72
    );
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
    const isNewTurn = Boolean(
      lastMessageId && lastMessageId !== previousLastMessageIdRef.current,
    );
    previousLastMessageIdRef.current = lastMessageId;
    if (isNewTurn) stickToBottomRef.current = true;
    if (!stickToBottomRef.current) return;
    const frame = requestAnimationFrame(() => scrollToLatest());
    return () => cancelAnimationFrame(frame);
  }, [currentMessages, streamingMessageId, streamingText, scrollToLatest]);

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className={`h-full overflow-y-auto custom-scrollbar ${compact ? "py-4" : "py-6"}`}
      >
        {visibleMessages.length === 0 ? (
          <div className="flex min-h-[50vh] items-center justify-center px-6 text-center">
            <div className="w-full max-w-lg flex flex-col items-center gap-5">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm">
                <MessageSquare className="size-6" />
              </div>
              <div className="flex flex-col items-center gap-2">
                <h2 className="text-xl font-semibold tracking-tight text-foreground">
                  {translate("Start a conversation") || "Start a conversation"}
                </h2>
                <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
                  {translate(
                    "Select a model and start chatting with any AI from your connected providers.",
                  ) ||
                    "Select a model and start chatting with any AI from your connected providers."}
                </p>
              </div>
              <div className="grid w-full gap-2 text-left sm:grid-cols-3">
                {STARTER_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() =>
                      setDraft(translate(suggestion) || suggestion)
                    }
                    className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm leading-5 text-foreground shadow-sm transition-all hover:border-primary/40 hover:bg-accent hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {translate(suggestion) || suggestion}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        <div
          className={`mx-auto flex w-full max-w-4xl flex-col px-6 ${compact ? "gap-3" : "gap-6"}`}
        >
          {visibleMessages.map((message) => {
            const isUser = message.role === "user";
            const isAssistant = message.role === "assistant";
            const isStreaming =
              isAssistant &&
              message.id === streamingMessageId &&
              message.status === "streaming";
            const isError = message.status === "error";
            const content =
              textValue(message.content) || (isAssistant ? streamingText : "");

            return (
              <div
                key={message.id}
                className={`group/msg flex w-full chat-message-enter ${isUser ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[min(90%,46rem)] ${isUser ? `rounded-2xl bg-primary text-primary-foreground shadow-sm ${compact ? "px-4 py-2.5" : "px-5 py-3.5"}` : "text-foreground"}`}
                >
                  {/* Message header */}
                  <div
                    className={`${compact ? "mb-1" : "mb-2"} flex items-center gap-2`}
                  >
                    <span
                      className={`text-xs font-semibold ${isUser ? "text-primary-foreground/70" : "text-muted-foreground"}`}
                    >
                      {isUser
                        ? translate("You") || "You"
                        : message.modelName ||
                          activeModel?.name ||
                          translate("Assistant") ||
                          "Assistant"}
                    </span>
                    {isAssistant && message.responseSource === "synapse" && (
                      <Badge
                        variant="secondary"
                        className="gap-1 text-[10px] px-1.5 py-0"
                        title={
                          translate(
                            "Resposta local determinística (Synapse) — não usou o modelo.",
                          ) ||
                          "Resposta local determinística (Synapse) — não usou o modelo."
                        }
                      >
                        <Zap className="size-2.5" />
                        {translate("Local") || "Local"}
                      </Badge>
                    )}
                    {isError && (
                      <Badge
                        variant="destructive"
                        className="text-[10px] px-1.5 py-0"
                      >
                        Error
                      </Badge>
                    )}
                  </div>

                  {/* Attachments */}
                  {message.attachments?.length ? (
                    <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {message.attachments.map((attachment) => (
                        <a
                          key={attachment.id}
                          href={attachment.dataUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="overflow-hidden rounded-lg border border-border bg-muted/40"
                        >
                          <DynamicMedia
                            src={attachment.dataUrl}
                            alt={attachment.name}
                            className="h-24 w-full object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  ) : null}

                  {/* Message content */}
                  {isAssistant ? (
                    <SafeMarkdown
                      source={content}
                      className={
                        compact
                          ? "prose-chat text-sm leading-6"
                          : "prose-chat text-[15px] leading-7"
                      }
                    />
                  ) : (
                    <div
                      className={`whitespace-pre-wrap break-words ${compact ? "text-sm leading-6" : "text-[15px] leading-7"}`}
                    >
                      {content}
                    </div>
                  )}

                  {/* Streaming cursor */}
                  {isAssistant && isStreaming && !streamingText && (
                    <span className="inline-block animate-pulse text-primary">
                      ▋
                    </span>
                  )}

                  {/* Tool calls */}
                  {message.toolCalls && message.toolCalls.length > 0 && (
                    <div className="mt-3 flex flex-col gap-1.5">
                      {message.toolCalls.map((tc) => {
                        const media = extractToolMedia(tc);
                        return (
                          <div
                            key={tc.id}
                            className="rounded-lg border border-border bg-muted/40 px-3.5 py-2.5"
                          >
                            <div className="flex items-center gap-2">
                              <Wrench className="size-3.5 text-muted-foreground" />
                              <span className="text-xs font-medium text-foreground">
                                {tc.name}
                              </span>
                              <Badge
                                variant={
                                  tc.status === "done"
                                    ? "default"
                                    : tc.status === "error"
                                      ? "destructive"
                                      : "secondary"
                                }
                                className="text-[9px] px-1.5 py-0"
                              >
                                {tc.status || "pending"}
                              </Badge>
                            </div>
                            {media?.kind === "image" && (
                              <DynamicMedia
                                src={media.url}
                                alt=""
                                className="mt-2 max-h-64 rounded-lg border border-border object-contain"
                              />
                            )}
                            {media?.kind === "audio" && (
                              <audio
                                controls
                                src={media.url}
                                className="mt-2 w-full"
                              />
                            )}
                            {media?.kind === "video" && (
                              <video
                                controls
                                src={media.url}
                                className="mt-2 max-h-64 w-full rounded-lg border border-border"
                              />
                            )}
                            {!compact && tc.result && (
                              <pre className="mt-1.5 text-[11px] text-muted-foreground overflow-x-auto max-h-32 overflow-y-auto">
                                {tc.result.slice(0, 500)}
                                {tc.result.length > 500 ? "..." : ""}
                              </pre>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Message actions */}
                  {isAssistant && !isStreaming && content && (
                    <div className="mt-3.5 flex items-center gap-1.5 opacity-0 transition-opacity group-focus-within/msg:opacity-100 group-hover/msg:opacity-100">
                      <button
                        type="button"
                        onClick={() => handleCopyMessage(message.id, content)}
                        aria-label={
                          translate("Copy response") || "Copy response"
                        }
                        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      >
                        {copiedMessageId === message.id ? (
                          <>
                            <Check className="size-3.5" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="size-3.5" /> Copy
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleFeedback(message.id, "up")}
                        aria-label={
                          translate("Good response") || "Good response"
                        }
                        className={`flex items-center rounded-md px-2 py-1.5 transition-colors ${message.feedback === "up" ? "text-success-foreground bg-success" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                      >
                        <ThumbsUp className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleFeedback(message.id, "down")}
                        aria-label={
                          translate("Poor response") || "Poor response"
                        }
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
                          <RefreshCw className="size-3.5" />{" "}
                          {translate("Regenerate") || "Regenerate"}
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
                        <div className="ml-auto flex items-center gap-1.5">
                          <Popover>
                            <PopoverTrigger className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                              <Hash className="size-2.5" />
                              Usage {(
                                (message.tokenUsage.total_tokens ??
                                  (message.tokenUsage.prompt_tokens || 0) +
                                    (message.tokenUsage.completion_tokens || 0)) / 1000
                              ).toFixed(1)}K tok
                            </PopoverTrigger>
                            <PopoverContent className="w-64 text-xs" align="start">
                              <dl className="grid grid-cols-2 gap-y-1.5">
                                <dt className="text-muted-foreground">Provider / model</dt>
                                <dd className="text-right font-medium">
                                  {message.providerName ?? "—"}/{message.modelName ?? "—"}
                                </dd>
                                {message.tokenUsage.cached_tokens != null && message.tokenUsage.prompt_tokens ? (
                                  <>
                                    <dt className="text-muted-foreground">Cache hit</dt>
                                    <dd className="text-right font-medium">
                                      {((message.tokenUsage.cached_tokens / message.tokenUsage.prompt_tokens) * 100).toFixed(1)}%
                                    </dd>
                                  </>
                                ) : null}
                                <dt className="text-muted-foreground">Uncached input</dt>
                                <dd className="text-right font-medium">
                                  {(message.tokenUsage.prompt_tokens ?? 0) - (message.tokenUsage.cached_tokens ?? 0)} tok
                                </dd>
                                {message.tokenUsage.cached_tokens != null && (
                                  <>
                                    <dt className="text-muted-foreground">Cached input</dt>
                                    <dd className="text-right font-medium">{message.tokenUsage.cached_tokens} tok</dd>
                                  </>
                                )}
                                <dt className="text-muted-foreground">Output</dt>
                                <dd className="text-right font-medium">{message.tokenUsage.completion_tokens ?? 0} tok</dd>
                              </dl>
                            </PopoverContent>
                          </Popover>
                          {message.timing && (
                            <Popover>
                              <PopoverTrigger className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                                Ran for {(message.timing.totalMs / 1000).toFixed(0)}s
                              </PopoverTrigger>
                              <PopoverContent className="w-56 text-xs" align="start">
                                <dl className="grid grid-cols-2 gap-y-1.5">
                                  <dt className="text-muted-foreground">Total run time</dt>
                                  <dd className="text-right font-medium">{(message.timing.totalMs / 1000).toFixed(1)}s</dd>
                                  <dt className="text-muted-foreground">Tokens per second</dt>
                                  <dd className="text-right font-medium">
                                    {message.tokenUsage.completion_tokens
                                      ? (message.tokenUsage.completion_tokens / (message.timing.totalMs / 1000)).toFixed(0)
                                      : "—"} tok/s
                                  </dd>
                                  <dt className="text-muted-foreground">Time to first token</dt>
                                  <dd className="text-right font-medium">{(message.timing.ttftMs / 1000).toFixed(1)}s</dd>
                                </dl>
                              </PopoverContent>
                            </Popover>
                          )}
                        </div>
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

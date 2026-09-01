"use client";

import { useCallback, useRef, useState } from "react";
import { textValue } from "../chatFormatUtils";
import type { SendMessageOptions } from "../types";
import { buildChatFetchOptions, buildRequestMessages } from "./buildChatRequest";
import { executeChatFetch } from "./consumeSSEStream";
import { exportConversation } from "./exportConversation";
import { finalizeStreamError, finalizeStreamSuccess } from "./finalizeStreamResult";
import { applyNewMessages, createAssistantMessage, createUserMessage, ensureChatSession } from "./prepareChatMessages";
import { prepareRetryMessage } from "./prepareRetryMessage";
import type { UseSendMessageArgs, UseSendMessageReturn } from "./useSendMessageTypes";
export type { UseSendMessageReturn } from "./useSendMessageTypes";
// Owns the streaming chat request lifecycle: building the request, reading
// the SSE stream into the active session's assistant message, retry/stop/
// feedback/export actions, and the transient error/streaming UI state.
export function useSendMessage({
  activeModel, activeProviderGroup, activeSessionId, setActiveSessionId, sessions, setSessions,
  updateSession, ensureSessionForModel, draft, setDraft, attachments, setAttachments,
  systemPrompt, temperature, apiKey, recordHarnessEvent, setBlockedModelIds,
}: UseSendMessageArgs): UseSendMessageReturn {
  const [chatError, setChatError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const canSend = !isSending && !!activeModel && (draft.trim().length > 0 || attachments.length > 0);
  const resetStream = useCallback(() => { setStreamingMessageId(""); setStreamingText(""); }, []);
  const handleStop = () => { abortRef.current?.abort(); };

  const sendMessage = useCallback(async (options?: SendMessageOptions) => {
    const model = activeModel || activeProviderGroup?.models?.[0] || null;
    if (!model) return;
    const userText = (options?.text ?? draft).trim();
    const messageAttachments = options?.attachments ?? attachments;
    if (!userText && messageAttachments.length === 0) return;

    const sessionResult = ensureChatSession(activeSessionId, sessions, model, ensureSessionForModel, setSessions, setActiveSessionId);
    if (!sessionResult) return;
    const { sessionId, session } = sessionResult;

    const userMessage = createUserMessage(userText, messageAttachments);
    const assistantMessage = createAssistantMessage(model);
    const assistantMessageId = assistantMessage.id;
    const nextMessages = [...(options?.baseMessages ?? session.messages ?? []), userMessage, assistantMessage];

    recordHarnessEvent(sessionId, "user/message", { messageId: userMessage.id, content: userText });
    recordHarnessEvent(sessionId, "run/start", { runId: assistantMessageId, modelId: model.id, providerId: model.providerId });
    applyNewMessages(sessionId, model, nextMessages, userText, setSessions);
    if (!options) { setDraft(""); setAttachments([]); }
    setChatError(""); setIsSending(true);
    setStreamingMessageId(assistantMessageId); setStreamingText("");
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const requestMessages = buildRequestMessages(nextMessages, assistantMessageId, systemPrompt);
    const fetchOptions = buildChatFetchOptions(model, requestMessages, temperature, apiKey, abortRef.current.signal);

    try {
      const result = await executeChatFetch("/api/v1/chat/completions", fetchOptions, (text) => {
        setStreamingText(text);
        updateSession(sessionId, (s) => ({
          ...s,
          messages: s.messages.map((m) => (m.id === assistantMessageId ? { ...m, content: text, status: "streaming" as const } : m)),
          updatedAt: new Date().toISOString(),
        }));
      });
      if (result.streamed) {
        finalizeStreamSuccess(sessionId, assistantMessageId, result.text, userText, updateSession, recordHarnessEvent);
      } else {
        updateSession(sessionId, (s) => ({
          ...s,
          messages: s.messages.map((m) => (m.id === assistantMessageId ? { ...m, content: result.text, status: "done" as const } : m)),
          updatedAt: new Date().toISOString(),
        }));
      }
    } catch (error: unknown) {
      finalizeStreamError(sessionId, assistantMessageId, error, model.id, updateSession, recordHarnessEvent, setChatError, setBlockedModelIds);
    } finally {
      setIsSending(false); setStreamingMessageId(""); setStreamingText("");
      abortRef.current = null;
    }
  }, [
    activeModel,
    activeProviderGroup,
    draft,
    attachments,
    activeSessionId,
    sessions,
    ensureSessionForModel,
    setSessions,
    setActiveSessionId,
    recordHarnessEvent,
    setDraft,
    setAttachments,
    systemPrompt,
    temperature,
    apiKey,
    updateSession,
    setBlockedModelIds,
  ]);

  const handleCopyMessage = useCallback(async (messageId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(textValue(content));
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(""), 2000);
    } catch { /* Ignore clipboard errors */ }
  }, []);

  const handleRetryMessage = useCallback((messageId: string) => {
    const opts = prepareRetryMessage(sessions, activeSessionId, activeModel, messageId);
    if (opts) void sendMessage(opts);
  }, [sessions, activeSessionId, activeModel, sendMessage]);

  const handleFeedback = useCallback((messageId: string, feedback: "up" | "down") => {
    updateSession(activeSessionId, (session) => ({
      ...session,
      messages: session.messages.map((m) => (m.id === messageId ? { ...m, feedback: m.feedback === feedback ? null : feedback } : m)),
    }));
  }, [activeSessionId, updateSession]);

  const handleExportConversation = useCallback((format: "json" | "markdown") => {
    exportConversation(sessions, activeSessionId, format);
  }, [sessions, activeSessionId]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (canSend) void sendMessage(); }
  };

  return {
    chatError, setChatError, isSending, streamingMessageId, streamingText, copiedMessageId, canSend,
    sendMessage, handleStop, resetStream, handleCopyMessage, handleRetryMessage, handleFeedback,
    handleExportConversation, handleKeyDown,
  };
}

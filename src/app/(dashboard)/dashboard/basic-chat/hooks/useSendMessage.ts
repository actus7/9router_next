"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { textValue } from "../chatFormatUtils";
import { isPuterBrowserModel, streamPuterChat, toPuterMessages } from "../puterBrowser";
import type { SendMessageOptions } from "../types";
import { buildChatFetchOptions, buildRequestMessages } from "./buildChatRequest";
import { executeChatFetch } from "./consumeSSEStream";
import { executeRuntimeToolCall } from "./executeRuntimeToolCall";
import { exportConversation } from "./exportConversation";
import { finalizeStreamError, finalizeStreamSuccess } from "./finalizeStreamResult";
import { applyNewMessages, createAssistantMessage, createUserMessage, ensureChatSession } from "./prepareChatMessages";
import { prepareRetryMessage } from "./prepareRetryMessage";
import { runtimeToolDefinitions } from "./runtimeToolDefinitions";
import type { AgentActivity, UseSendMessageArgs, UseSendMessageReturn } from "./useSendMessageTypes";
export type { UseSendMessageReturn } from "./useSendMessageTypes";
// Owns the streaming chat request lifecycle: building the request, reading
// the SSE stream into the active session's assistant message, retry/stop/
// feedback/export actions, and the transient error/streaming UI state.
export function useSendMessage({
  activeModel, activeProviderGroup, activeSessionId, setActiveSessionId, sessions, setSessions,
  updateSession, ensureSessionForModel, draft, setDraft, attachments, setAttachments,
  systemPrompt, temperature, apiKey, recordHarnessEvent,
}: UseSendMessageArgs): UseSendMessageReturn {
  const [chatError, setChatError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [liveActivities, setLiveActivities] = useState<AgentActivity[]>([]);
  const [copiedMessageId, setCopiedMessageId] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const queuedMessageRef = useRef<SendMessageOptions | null>(null);
  const sessionsRef = useRef(sessions);
  const activityClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [queuedMessage, setQueuedMessage] = useState("");

  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  const canSend = !isSending && !!activeModel && (draft.trim().length > 0 || attachments.length > 0);
  const canQueue = isSending && !queuedMessage && (draft.trim().length > 0 || attachments.length > 0);
  const resetStream = useCallback(() => {
    if (activityClearTimerRef.current) clearTimeout(activityClearTimerRef.current);
    activityClearTimerRef.current = null;
    queuedMessageRef.current = null;
    setQueuedMessage("");
    setStreamingMessageId("");
    setStreamingText("");
    setLiveActivities([]);
  }, []);
  const handleStop = () => { abortRef.current?.abort(); };

  const sendMessage = useCallback(async (options?: SendMessageOptions) => {
    const model = activeModel || activeProviderGroup?.models?.[0] || null;
    if (!model) return;
    const userText = (options?.text ?? draft).trim();
    const messageAttachments = options?.attachments ?? attachments;
    if (!userText && messageAttachments.length === 0) return;

    const sessionResult = ensureChatSession(activeSessionId, sessionsRef.current, model, ensureSessionForModel, setSessions, setActiveSessionId);
    if (!sessionResult) return;
    const { sessionId, session } = sessionResult;

    const userMessage = createUserMessage(userText, messageAttachments);
    const assistantMessage = createAssistantMessage(model);
    const assistantMessageId = assistantMessage.id;
    let currentRunId = assistantMessageId;
    const nextMessages = [...(options?.baseMessages ?? session.messages ?? []), userMessage, assistantMessage];

    recordHarnessEvent(sessionId, "user/message", { messageId: userMessage.id, content: userText });
    recordHarnessEvent(sessionId, "run/start", { runId: assistantMessageId, modelId: model.id, providerId: model.providerId });
    applyNewMessages(sessionId, model, nextMessages, userText, setSessions);
    if (!options) { setDraft(""); setAttachments([]); }
    setChatError(""); setIsSending(true);
    if (activityClearTimerRef.current) clearTimeout(activityClearTimerRef.current);
    activityClearTimerRef.current = null;
    setStreamingMessageId(assistantMessageId); setStreamingText("");
    setLiveActivities([{ id: assistantMessageId, label: "Pensando", detail: model.name, state: "running" }]);
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const effectiveSystemPrompt = [
      systemPrompt.trim(),
      session.mode === "plan"
        ? "Planning mode is active. Analyze the request and return a clear, actionable plan. Do not call tools or claim that you executed steps."
        : "",
    ].filter(Boolean).join("\n\n");
    const requestMessages = buildRequestMessages(nextMessages, assistantMessageId, effectiveSystemPrompt);
    const signal = abortRef.current.signal;
    const runtimeTools = session.mode !== "plan" && !isPuterBrowserModel(model) && model.caps?.tools !== false ? runtimeToolDefinitions : undefined;
    const fetchOptions = buildChatFetchOptions(model, requestMessages, temperature, apiKey, signal, runtimeTools);

    try {
      const updateStreamingText = (text: string) => {
        setStreamingText(text);
        setLiveActivities((activities) => activities.map((activity) => activity.id === assistantMessageId
          ? { ...activity, label: "Respondendo", state: "streaming" }
          : activity));
        updateSession(sessionId, (s) => ({
          ...s,
          messages: s.messages.map((m) => (m.id === assistantMessageId ? { ...m, content: text, status: "streaming" as const } : m)),
          updatedAt: new Date().toISOString(),
        }));
      };
      const result = isPuterBrowserModel(model)
        ? await (async () => {
            let text = "";
            const finalText = await streamPuterChat({
              messages: toPuterMessages(nextMessages, assistantMessageId, effectiveSystemPrompt),
              signal,
              onTextDelta: (delta) => {
                text += delta;
                updateStreamingText(text);
              },
            });
            return { streamed: true, text: finalText || text, toolCalls: [], reasoning: "", usage: null };
          })()
        : await executeChatFetch("/api/v1/chat/completions", fetchOptions, updateStreamingText);
      if (result.streamed) {
        finalizeStreamSuccess(sessionId, assistantMessageId, result.text, userText, updateSession, recordHarnessEvent, { reasoning: result.reasoning, usage: result.usage });
      } else {
        updateSession(sessionId, (s) => ({
          ...s,
          messages: s.messages.map((m) => (m.id === assistantMessageId ? { ...m, content: result.text, status: "done" as const } : m)),
          updatedAt: new Date().toISOString(),
        }));
      }
      if (result.toolCalls.length > 0) {
        setLiveActivities(result.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          label: toolCall.name,
          detail: "Em execução",
          state: "running" as const,
        })));
        updateSession(sessionId, (s) => ({
          ...s,
          messages: s.messages.map((m) => (
            m.id === assistantMessageId ? { ...m, toolCalls: result.toolCalls } : m
          )),
          updatedAt: new Date().toISOString(),
        }));
        for (const toolCall of result.toolCalls) {
          recordHarnessEvent(sessionId, "tool/call", {
            runId: assistantMessageId,
            toolCallId: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.arguments,
          });
        }
        if (runtimeTools) {
          let conversation = [
            ...nextMessages.slice(0, -1),
            { ...assistantMessage, content: result.text, status: "done", toolCalls: result.toolCalls },
          ];
          let pendingCalls = result.toolCalls;
          let runId = assistantMessageId;

          for (let step = 0; step < 8 && pendingCalls.length > 0; step += 1) {
            updateSession(sessionId, (s) => ({
              ...s,
              messages: s.messages.map((message) => message.id === runId
                ? { ...message, toolCalls: pendingCalls.map((call) => ({ ...call, status: "running" as const })) }
                : message),
              updatedAt: new Date().toISOString(),
            }));
            const toolMessages = await Promise.all(pendingCalls.map(async (call) => {
              try {
                const content = await executeRuntimeToolCall(call, { apiKey, model, signal });
                const failed = content.includes('"ok":false');
                setLiveActivities((activities) => activities.map((activity) => activity.id === call.id
                  ? { ...activity, detail: failed ? "Não concluída" : "Concluída", state: failed ? "error" : "done" }
                  : activity));
                updateSession(sessionId, (s) => ({
                  ...s,
                  messages: s.messages.map((message) => message.id === runId
                    ? { ...message, toolCalls: message.toolCalls?.map((toolCall) => toolCall.id === call.id
                      ? { ...toolCall, result: content, status: failed ? "error" : "done" }
                      : toolCall) }
                    : message),
                  updatedAt: new Date().toISOString(),
                }));
                recordHarnessEvent(sessionId, "tool/result", { runId, toolCallId: call.id, name: call.name, content });
                return { id: crypto.randomUUID(), role: "tool", toolCallId: call.id, content, createdAt: new Date().toISOString(), status: failed ? "error" as const : "done" as const };
              } catch (error) {
                const content = JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Tool execution failed" });
                setLiveActivities((activities) => activities.map((activity) => activity.id === call.id
                  ? { ...activity, detail: "Não concluída", state: "error" }
                  : activity));
                recordHarnessEvent(sessionId, "tool/result", { runId, toolCallId: call.id, name: call.name, content });
                return { id: crypto.randomUUID(), role: "tool", toolCallId: call.id, content, createdAt: new Date().toISOString(), status: "error" as const };
              }
            }));
            conversation = conversation.map((message) => message.id === runId
              ? { ...message, toolCalls: pendingCalls.map((call, index) => ({ ...call, result: toolMessages[index].content, status: toolMessages[index].status === "error" ? "error" as const : "done" as const })) }
              : message);
            conversation = [...conversation, ...toolMessages];
            updateSession(sessionId, (s) => ({ ...s, messages: conversation, updatedAt: new Date().toISOString() }));

            const continuation = createAssistantMessage(model);
            currentRunId = continuation.id;
            setLiveActivities((activities) => [...activities, { id: continuation.id, label: "Sintetizando", detail: model.name, state: "running" }]);
            conversation = [...conversation, continuation];
            updateSession(sessionId, (s) => ({ ...s, messages: conversation, updatedAt: new Date().toISOString() }));
            recordHarnessEvent(sessionId, "run/start", { runId: continuation.id, modelId: model.id, providerId: model.providerId, parentRunId: runId });
            setStreamingMessageId(continuation.id); setStreamingText("");
            const continuationResult = await executeChatFetch(
              "/api/v1/chat/completions",
              buildChatFetchOptions(model, buildRequestMessages(conversation, continuation.id, effectiveSystemPrompt), temperature, apiKey, signal, runtimeTools),
              (text) => {
                setStreamingText(text);
                setLiveActivities((activities) => activities.map((activity) => activity.id === continuation.id
                  ? { ...activity, label: "Respondendo", state: "streaming" }
                  : activity));
                updateSession(sessionId, (s) => ({
                  ...s,
                  messages: s.messages.map((message) => message.id === continuation.id ? { ...message, content: text, status: "streaming" } : message),
                  updatedAt: new Date().toISOString(),
                }));
              },
            );
            conversation = conversation.map((message) => message.id === continuation.id
              ? { ...message, content: continuationResult.text, status: "done", toolCalls: continuationResult.toolCalls, tokenUsage: continuationResult.usage ?? message.tokenUsage }
              : message);
            updateSession(sessionId, (s) => ({ ...s, messages: conversation, updatedAt: new Date().toISOString() }));
            setLiveActivities((activities) => activities.map((activity) => activity.id === continuation.id
              ? { ...activity, detail: "Concluída", state: "done" }
              : activity));
            if (continuationResult.reasoning) {
              recordHarnessEvent(sessionId, "assistant/reasoning", { runId: continuation.id, content: continuationResult.reasoning });
            }
            recordHarnessEvent(sessionId, "assistant/message", { runId: continuation.id, content: continuationResult.text });
            if (continuationResult.toolCalls.length === 0) {
              recordHarnessEvent(sessionId, "run/complete", { runId: continuation.id, ...(continuationResult.usage ? { usage: continuationResult.usage } : {}) });
            }
            pendingCalls = continuationResult.toolCalls;
            runId = continuation.id;
            for (const toolCall of pendingCalls) {
              recordHarnessEvent(sessionId, "tool/call", { runId, toolCallId: toolCall.id, name: toolCall.name, arguments: toolCall.arguments });
            }
          }
        }
      }
    } catch (error: unknown) {
      setLiveActivities((activities) => activities.map((activity) => activity.id === currentRunId
        ? { ...activity, detail: "Interrompida", state: "error" }
        : activity));
      finalizeStreamError(sessionId, currentRunId, error, updateSession, recordHarnessEvent, setChatError);
    } finally {
      setIsSending(false); setStreamingMessageId(""); setStreamingText("");
      abortRef.current = null;
      const queued = queuedMessageRef.current;
      if (queued) {
        queuedMessageRef.current = null;
        setQueuedMessage("");
        window.setTimeout(() => { void sendMessage(queued); }, 0);
      } else {
        activityClearTimerRef.current = setTimeout(() => {
          setLiveActivities([]);
          activityClearTimerRef.current = null;
        }, 900);
      }
    }
  }, [
    activeModel,
    activeProviderGroup,
    draft,
    attachments,
    activeSessionId,
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
  ]);

  const queueMessage = useCallback(() => {
    if (!canQueue) return;
    const text = draft.trim();
    queuedMessageRef.current = { text, attachments };
    setQueuedMessage(text || `${attachments.length} anexo${attachments.length === 1 ? "" : "s"}`);
    setDraft("");
    setAttachments([]);
  }, [attachments, canQueue, draft, setAttachments, setDraft]);

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
    chatError, setChatError, isSending, streamingMessageId, streamingText, liveActivities, copiedMessageId, canSend, canQueue, queuedMessage,
    sendMessage, queueMessage, handleStop, resetStream, handleCopyMessage, handleRetryMessage, handleFeedback,
    handleExportConversation, handleKeyDown,
  };
}

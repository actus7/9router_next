"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { textValue } from "../chatFormatUtils";
import {
  getEnabledRuntimeToolNames,
  getMcpRuntimeToolDefinitions,
  getRuntimeToolDefinitions,
  resolveSessionPlugins,
} from "@/shared/harness/agentPlugins";
import {
  isPuterBrowserModel,
  streamPuterChat,
  toPuterMessages,
} from "../puterBrowser";
import type { SendMessageOptions } from "../types";
import {
  buildChatFetchOptions,
  buildRequestMessages,
} from "./buildChatRequest";
import { executeChatFetch } from "./consumeSSEStream";
import { exportConversation } from "./exportConversation";
import {
  finalizeStreamError,
  finalizeStreamSuccess,
} from "./finalizeStreamResult";
import {
  applyNewMessages,
  createAssistantMessage,
  createUserMessage,
  ensureChatSession,
} from "./prepareChatMessages";
import { prepareRetryMessage } from "./prepareRetryMessage";
import { runToolCallLoop } from "./runToolCallLoop";
import type {
  AgentActivity,
  UseSendMessageArgs,
  UseSendMessageReturn,
} from "./useSendMessageTypes";
export type { UseSendMessageReturn } from "./useSendMessageTypes";
// Owns the streaming chat request lifecycle: building the request, reading
// the SSE stream into the active session's assistant message, retry/stop/
// feedback/export actions, and the transient error/streaming UI state.
export function useSendMessage({
  activeModel,
  activeProviderGroup,
  activeSessionId,
  setActiveSessionId,
  sessions,
  setSessions,
  updateSession,
  ensureSessionForModel,
  draft,
  setDraft,
  attachments,
  setAttachments,
  systemPrompt,
  temperature,
  enterBehavior,
  apiKey,
  recordHarnessEvent,
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
  const activityClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const queuedReplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [queuedMessage, setQueuedMessage] = useState("");

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  // Navigating away mid-stream must not leave the request running or keep
  // updating state on an unmounted component.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (activityClearTimerRef.current)
        clearTimeout(activityClearTimerRef.current);
      if (queuedReplayTimerRef.current)
        clearTimeout(queuedReplayTimerRef.current);
    };
  }, []);

  const canSend =
    !isSending &&
    !!activeModel &&
    (draft.trim().length > 0 || attachments.length > 0);
  const canQueue =
    isSending &&
    !queuedMessage &&
    (draft.trim().length > 0 || attachments.length > 0);
  const resetStream = useCallback(() => {
    if (activityClearTimerRef.current)
      clearTimeout(activityClearTimerRef.current);
    activityClearTimerRef.current = null;
    queuedMessageRef.current = null;
    setQueuedMessage("");
    setStreamingMessageId("");
    setStreamingText("");
    setLiveActivities([]);
  }, []);
  const handleStop = () => {
    abortRef.current?.abort();
  };

  const sendMessage = useCallback(
    async (options?: SendMessageOptions) => {
      const model = activeModel || activeProviderGroup?.models?.[0] || null;
      if (!model) return;
      const userText = (options?.text ?? draft).trim();
      const messageAttachments = options?.attachments ?? attachments;
      if (!userText && messageAttachments.length === 0) return;

      const sessionResult = ensureChatSession(
        activeSessionId,
        sessionsRef.current,
        model,
        ensureSessionForModel,
        setSessions,
        setActiveSessionId,
      );
      if (!sessionResult) return;
      const { sessionId, session } = sessionResult;

      const userMessage = createUserMessage(userText, messageAttachments);
      const assistantMessage = createAssistantMessage(model);
      const assistantMessageId = assistantMessage.id;
      let currentRunId = assistantMessageId;
      const nextMessages = [
        ...(options?.baseMessages ?? session.messages ?? []),
        userMessage,
        assistantMessage,
      ];

      recordHarnessEvent(sessionId, "user/message", {
        messageId: userMessage.id,
        content: userText,
      });
      recordHarnessEvent(sessionId, "run/start", {
        runId: assistantMessageId,
        modelId: model.id,
        providerId: model.providerId,
      });
      applyNewMessages(sessionId, model, nextMessages, userText, setSessions);
      if (!options) {
        setDraft("");
        setAttachments([]);
      }
      setChatError("");
      setIsSending(true);
      if (activityClearTimerRef.current)
        clearTimeout(activityClearTimerRef.current);
      activityClearTimerRef.current = null;
      setStreamingMessageId(assistantMessageId);
      setStreamingText("");
      setLiveActivities([
        {
          id: assistantMessageId,
          label: "Pensando",
          detail: model.name,
          state: "running",
        },
      ]);
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      const sessionPlugins = resolveSessionPlugins(
        session.agentPresetId,
        session.pluginOverrides,
      );
      const hasPlugin = (pluginId: string) =>
        sessionPlugins.some((plugin) => plugin.id === pluginId);
      const effectiveSystemPrompt = [
        hasPlugin("agent-instructions") ? systemPrompt.trim() : "",
        session.mode === "plan" && hasPlugin("plan-mode")
          ? "Planning mode is active. Analyze the request and return a clear, actionable plan. Do not call tools or claim that you executed steps."
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const requestMessages = buildRequestMessages(
        nextMessages,
        assistantMessageId,
        effectiveSystemPrompt,
      );
      const signal = abortRef.current.signal;
      const builtinRuntimeTools =
        session.mode !== "plan" &&
        !isPuterBrowserModel(model) &&
        model.caps?.tools !== false
          ? getRuntimeToolDefinitions(
              session.agentPresetId,
              session.pluginOverrides,
            )
          : undefined;
      const mcpRuntimeTools =
        session.mode !== "plan" &&
        !isPuterBrowserModel(model) &&
        model.caps?.tools !== false
          ? getMcpRuntimeToolDefinitions(session.mcpServers)
          : [];
      const runtimeTools =
        builtinRuntimeTools || mcpRuntimeTools.length
          ? [...(builtinRuntimeTools ?? []), ...mcpRuntimeTools]
          : undefined;
      const enabledToolNames = getEnabledRuntimeToolNames(
        session.agentPresetId,
        session.pluginOverrides,
      );
      for (const tool of mcpRuntimeTools)
        enabledToolNames.add(tool.function.name);
      const fetchOptions = buildChatFetchOptions(
        model,
        requestMessages,
        temperature,
        apiKey,
        signal,
        runtimeTools,
      );

      try {
        const updateStreamingText = (text: string) => {
          setStreamingText(text);
          setLiveActivities((activities) =>
            activities.map((activity) =>
              activity.id === assistantMessageId
                ? { ...activity, label: "Respondendo", state: "streaming" }
                : activity,
            ),
          );
          updateSession(sessionId, (s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === assistantMessageId
                ? { ...m, content: text, status: "streaming" as const }
                : m,
            ),
            updatedAt: new Date().toISOString(),
          }));
        };
        const result = isPuterBrowserModel(model)
          ? await (async () => {
              let text = "";
              const finalText = await streamPuterChat({
                messages: toPuterMessages(
                  nextMessages,
                  assistantMessageId,
                  effectiveSystemPrompt,
                ),
                signal,
                onTextDelta: (delta) => {
                  text += delta;
                  updateStreamingText(text);
                },
              });
              return {
                streamed: true,
                text: finalText || text,
                toolCalls: [],
                reasoning: "",
                usage: null,
                responseSource: null as "synapse" | null,
              };
            })()
          : await executeChatFetch(
              "/api/v1/chat/completions",
              fetchOptions,
              updateStreamingText,
            );
        if (result.streamed) {
          finalizeStreamSuccess(
            sessionId,
            assistantMessageId,
            result.text,
            userText,
            updateSession,
            recordHarnessEvent,
            {
              reasoning: result.reasoning,
              usage: result.usage,
              responseSource: result.responseSource,
            },
          );
        } else {
          updateSession(sessionId, (s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === assistantMessageId
                ? {
                    ...m,
                    content: result.text,
                    status: "done" as const,
                    responseSource: result.responseSource,
                  }
                : m,
            ),
            updatedAt: new Date().toISOString(),
          }));
        }
        if (result.toolCalls.length > 0) {
          setLiveActivities(
            result.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              label: toolCall.name,
              detail: "Em execução",
              state: "running" as const,
            })),
          );
          updateSession(sessionId, (s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === assistantMessageId
                ? { ...m, toolCalls: result.toolCalls }
                : m,
            ),
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
            currentRunId = await runToolCallLoop({
              sessionId,
              model,
              session,
              assistantMessage,
              assistantMessageId,
              nextMessages,
              resultText: result.text,
              initialToolCalls: result.toolCalls,
              effectiveSystemPrompt,
              temperature,
              apiKey,
              signal,
              runtimeTools,
              enabledToolNames,
              updateSession,
              recordHarnessEvent,
              setLiveActivities,
              setStreamingMessageId,
              setStreamingText,
            });
          }
        }
      } catch (error: unknown) {
        setLiveActivities((activities) =>
          activities.map((activity) =>
            activity.id === currentRunId
              ? { ...activity, detail: "Interrompida", state: "error" }
              : activity,
          ),
        );
        finalizeStreamError(
          sessionId,
          currentRunId,
          error,
          updateSession,
          recordHarnessEvent,
          setChatError,
        );
      } finally {
        setIsSending(false);
        setStreamingMessageId("");
        setStreamingText("");
        abortRef.current = null;
        const queued = queuedMessageRef.current;
        if (queued) {
          queuedMessageRef.current = null;
          setQueuedMessage("");
          queuedReplayTimerRef.current = setTimeout(() => {
            void sendMessage(queued);
          }, 0);
        } else {
          activityClearTimerRef.current = setTimeout(() => {
            setLiveActivities([]);
            activityClearTimerRef.current = null;
          }, 900);
        }
      }
    },
    [
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
    ],
  );

  const queueMessage = useCallback(() => {
    if (!canQueue) return;
    const text = draft.trim();
    queuedMessageRef.current = { text, attachments };
    setQueuedMessage(
      text ||
        `${attachments.length} anexo${attachments.length === 1 ? "" : "s"}`,
    );
    setDraft("");
    setAttachments([]);
  }, [attachments, canQueue, draft, setAttachments, setDraft]);

  const steerMessage = useCallback(() => {
    if (!canQueue) return;
    queueMessage();
    abortRef.current?.abort();
  }, [canQueue, queueMessage]);

  const handleCopyMessage = useCallback(
    async (messageId: string, content: string) => {
      try {
        await navigator.clipboard.writeText(textValue(content));
        setCopiedMessageId(messageId);
        setTimeout(() => setCopiedMessageId(""), 2000);
      } catch {
        /* Ignore clipboard errors */
      }
    },
    [],
  );

  const handleRetryMessage = useCallback(
    (messageId: string) => {
      const opts = prepareRetryMessage(
        sessions,
        activeSessionId,
        activeModel,
        messageId,
      );
      if (opts) void sendMessage(opts);
    },
    [sessions, activeSessionId, activeModel, sendMessage],
  );

  const handleFeedback = useCallback(
    (messageId: string, feedback: "up" | "down") => {
      updateSession(activeSessionId, (session) => ({
        ...session,
        messages: session.messages.map((m) =>
          m.id === messageId
            ? { ...m, feedback: m.feedback === feedback ? null : feedback }
            : m,
        ),
      }));
    },
    [activeSessionId, updateSession],
  );

  const handleExportConversation = useCallback(
    (format: "json" | "markdown") => {
      exportConversation(sessions, activeSessionId, format);
    },
    [sessions, activeSessionId],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (isSending) {
      if (enterBehavior === "steer") steerMessage();
      else queueMessage();
      return;
    }
    if (canSend) void sendMessage();
  };

  return {
    chatError,
    setChatError,
    isSending,
    streamingMessageId,
    streamingText,
    liveActivities,
    copiedMessageId,
    canSend,
    canQueue,
    queuedMessage,
    sendMessage,
    queueMessage,
    steerMessage,
    handleStop,
    resetStream,
    handleCopyMessage,
    handleRetryMessage,
    handleFeedback,
    handleExportConversation,
    handleKeyDown,
  };
}

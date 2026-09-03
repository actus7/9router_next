import {
  buildSessionSystemPrompt,
  getEnabledRuntimeToolNames,
  getMcpRuntimeToolDefinitions,
  getRuntimeToolDefinitions,
  resolveSessionPlugins,
} from "@/shared/harness/agentPlugins";
import {
  buildSkillsPromptBlock,
  getUpdateSkillToolDefinition,
  resolveSessionSkills,
} from "@/shared/harness/agentSkills";
import {
  isPuterBrowserModel,
  streamPuterChat,
  toPuterMessages,
} from "../puterBrowser";
import type {
  ChatAttachment,
  ChatSession,
  NormalizedModel,
  ProviderGroup,
  SendMessageOptions,
} from "../types";
import {
  buildChatFetchOptions,
  buildRequestMessages,
} from "./buildChatRequest";
import { executeChatFetch } from "./consumeSSEStream";
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
import { runToolCallLoop } from "./runToolCallLoop";
import type { AgentActivity } from "./useSendMessageTypes";

export interface ExecuteSendMessageArgs {
  options?: SendMessageOptions;
  activeModel: NormalizedModel | null;
  activeProviderGroup: ProviderGroup | null;
  activeSessionId: string;
  setActiveSessionId: React.Dispatch<React.SetStateAction<string>>;
  sessionsRef: React.MutableRefObject<ChatSession[]>;
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  ensureSessionForModel: (
    model: NormalizedModel | null,
  ) => ChatSession | undefined;
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  attachments: ChatAttachment[];
  setAttachments: React.Dispatch<React.SetStateAction<ChatAttachment[]>>;
  systemPrompt: string;
  temperature: number;
  reasoningEffort: "low" | "medium" | "high" | null;
  apiKey: string;
  recordHarnessEvent: (
    sessionId: string,
    type: string,
    data: Record<string, unknown>,
  ) => void;
  updateSession: (
    sessionId: string,
    updater: (session: ChatSession) => ChatSession,
  ) => void;
  abortRef: React.MutableRefObject<AbortController | null>;
  setChatError: React.Dispatch<React.SetStateAction<string>>;
  setIsSending: React.Dispatch<React.SetStateAction<boolean>>;
  setStreamingMessageId: React.Dispatch<React.SetStateAction<string>>;
  setStreamingText: React.Dispatch<React.SetStateAction<string>>;
  setLiveActivities: React.Dispatch<React.SetStateAction<AgentActivity[]>>;
  activityClearTimerRef: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null>;
  dequeueNext: () => { text: string; attachments: ChatAttachment[] } | undefined;
  replayQueuedMessage: (item: {
    text: string;
    attachments: ChatAttachment[];
  }) => void;
}

export async function executeSendMessage({
  options,
  activeModel,
  activeProviderGroup,
  activeSessionId,
  setActiveSessionId,
  sessionsRef,
  setSessions,
  ensureSessionForModel,
  draft,
  setDraft,
  attachments,
  setAttachments,
  systemPrompt,
  temperature,
  reasoningEffort,
  apiKey,
  recordHarnessEvent,
  updateSession,
  abortRef,
  setChatError,
  setIsSending,
  setStreamingMessageId,
  setStreamingText,
  setLiveActivities,
  activityClearTimerRef,
  dequeueNext,
  replayQueuedMessage,
}: ExecuteSendMessageArgs): Promise<void> {
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

  const effectiveSystemPrompt = [
    buildSessionSystemPrompt(
      session.agentPresetId,
      session.pluginOverrides,
      systemPrompt,
      session.mode === "plan",
    ),
    resolveSessionPlugins(
      session.agentPresetId,
      session.pluginOverrides,
    ).some((plugin) => plugin.id === "tool-skills")
      ? buildSkillsPromptBlock(resolveSessionSkills(session.skillOverrides))
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
  const supplementalTools: ReturnType<typeof getRuntimeToolDefinitions> = [];
  const sessionPlugins = resolveSessionPlugins(
    session.agentPresetId,
    session.pluginOverrides,
  );
  if (sessionPlugins.some((plugin) => plugin.id === "tool-skill-authoring")) {
    supplementalTools.push(getUpdateSkillToolDefinition());
  }
  const runtimeTools =
    builtinRuntimeTools || mcpRuntimeTools.length || supplementalTools.length
      ? [
          ...(builtinRuntimeTools ?? []),
          ...mcpRuntimeTools,
          ...supplementalTools,
        ]
      : undefined;
  const enabledToolNames = getEnabledRuntimeToolNames(
    session.agentPresetId,
    session.pluginOverrides,
  );
  for (const tool of mcpRuntimeTools)
    enabledToolNames.add(tool.function.name);
  for (const tool of supplementalTools)
    enabledToolNames.add(tool.function.name);
  const fetchOptions = buildChatFetchOptions(
    model,
    requestMessages,
    temperature,
    apiKey,
    signal,
    runtimeTools,
    reasoningEffort,
  );

  const requestStartedAt = Date.now();
  let firstTokenAt: number | null = null;

  try {
    const updateStreamingText = (text: string) => {
      if (firstTokenAt === null && text) firstTokenAt = Date.now();
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
      const completedAt = Date.now();
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
          timing: {
            ttftMs: (firstTokenAt ?? completedAt) - requestStartedAt,
            totalMs: completedAt - requestStartedAt,
          },
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
          reasoningEffort,
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
    const next = dequeueNext();
    if (next) {
      replayQueuedMessage(next);
    } else {
      activityClearTimerRef.current = setTimeout(() => {
        setLiveActivities([]);
        activityClearTimerRef.current = null;
      }, 900);
    }
  }
}

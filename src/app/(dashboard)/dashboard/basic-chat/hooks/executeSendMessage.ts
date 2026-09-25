import {
  buildSessionSystemPrompt,
  getEnabledRuntimeToolNames,
  getMcpRuntimeToolDefinitions,
  getProposeHarnessCapabilityToolDefinition,
  getRuntimeToolDefinitions,
  resolveSessionPlugins,
} from "@/shared/harness/agentPlugins";
import {
  buildSkillsPromptBlock,
  getEnabledSkillIds,
  getSupplementalSkillAuthoringTools,
  getLoadSkillFileToolDefinition,
  resolveSessionSkills,
} from "@/shared/harness/agentSkills";
import { readSkillPreferences } from "@/shared/harness/skillPreferences";
import {
  buildMemoryPromptBlock,
  getSupplementalMemoryToolDefinitions,
} from "@/shared/harness/agentMemory";
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
import { readRoutingTraceFromError } from "./consumeSSEStream";
import { executeDurableChat, stopDurableRun } from "./executeDurableChat";
import { recordRoutingTraceEvent } from "./recordRoutingTraceEvent";
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
import type { QueuedMessage, SendScope } from "./useSendMessageTypes";

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
  setChatError: React.Dispatch<React.SetStateAction<string>>;
  /**
   * Claims this send's conversation and hands back everything it owns — the
   * abort controller, the run id, the stop flag, the stream state.
   *
   * Called once the conversation is known, which is why it is a factory rather
   * than a set of props: the id can be created inside this function.
   * `POST /api/harness/runs` is deliberately not given the abort signal, so
   * between the post and the answer that names the run there is nothing to
   * stop — hence `stopRequestedRef`, remembered until the run has a name.
   */
  beginSend: (sessionId: string) => SendScope;
  dequeueNext: (sessionId?: string) => QueuedMessage | undefined;
  replayQueuedMessage: (item: QueuedMessage) => void;
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
  setChatError,
  beginSend,
  dequeueNext,
  replayQueuedMessage,
}: ExecuteSendMessageArgs): Promise<void> {
  const model = options?.model || activeModel || activeProviderGroup?.models?.[0] || null;
  if (!model) return;
  const userText = (options?.text ?? draft).trim();
  const messageAttachments = options?.attachments ?? attachments;
  if (!userText && messageAttachments.length === 0) return;

  // A send that names its conversation is a replay of something typed there.
  // If that conversation is gone, the message goes with it: `ensureChatSession`
  // would make a replacement and select it, dragging the reader out of
  // whatever they had opened in the meantime.
  if (options?.sessionId && !sessionsRef.current.some((item) => item.id === options.sessionId)) return;

  const sessionResult = ensureChatSession(
    options?.sessionId ?? activeSessionId,
    sessionsRef.current,
    model,
    ensureSessionForModel,
    setSessions,
    setActiveSessionId,
  );
  if (!sessionResult) return;
  const { sessionId, session } = sessionResult;

  // From here on everything this send touches belongs to `sessionId`, so a
  // second send in another conversation cannot abort it, steal its run id, or
  // stream its tokens into whatever the reader happens to have open.
  const {
    abortRef,
    activeRunIdRef,
    stopRequestedRef,
    setStreamingMessageId,
    setStreamingText,
    setLiveActivities,
    setSending,
  } = beginSend(sessionId);

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
  setSending(true);
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

  let memoryPromptBlock = "";
  if (sessionPlugins.some((plugin) => plugin.id === "tool-memory")) {
    try {
      const memoryResponse = await fetch("/api/harness/memory", {
        signal: abortRef.current.signal,
        cache: "no-store",
      });
      const memoryPayload = (await memoryResponse.json().catch(() => null)) as {
        agent?: Parameters<typeof buildMemoryPromptBlock>[0]["agent"];
        user?: Parameters<typeof buildMemoryPromptBlock>[0]["user"];
        agentChars?: number;
        userChars?: number;
        agentLimit?: number;
        userLimit?: number;
      } | null;
      if (memoryResponse.ok && memoryPayload) {
        memoryPromptBlock = buildMemoryPromptBlock({
          revision: 0,
          agent: memoryPayload.agent ?? [],
          user: memoryPayload.user ?? [],
          agentChars: memoryPayload.agentChars ?? 0,
          userChars: memoryPayload.userChars ?? 0,
          agentLimit: memoryPayload.agentLimit ?? 2200,
          userLimit: memoryPayload.userLimit ?? 1375,
        });
      }
    } catch {
      memoryPromptBlock = "";
    }
  }

  const effectiveSystemPrompt = [
    buildSessionSystemPrompt(
      session.agentPresetId,
      session.pluginOverrides,
      systemPrompt,
      session.mode === "plan",
    ),
    sessionPlugins.some((plugin) => plugin.id === "tool-skills")
      ? buildSkillsPromptBlock(
          resolveSessionSkills(session.skillOverrides, readSkillPreferences()),
        )
      : "",
    memoryPromptBlock,
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
  if (sessionPlugins.some((plugin) => plugin.id === "tool-skills")) {
    supplementalTools.push(getLoadSkillFileToolDefinition());
  }
  if (sessionPlugins.some((plugin) => plugin.id === "tool-skill-authoring")) {
    supplementalTools.push(...getSupplementalSkillAuthoringTools());
  }
  if (sessionPlugins.some((plugin) => plugin.id === "tool-memory")) {
    supplementalTools.push(...getSupplementalMemoryToolDefinitions());
  }
  if (sessionPlugins.some((plugin) => plugin.id === "tool-harness-governance")) {
    supplementalTools.push(getProposeHarnessCapabilityToolDefinition());
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

  /** Records the run, and honours a stop that was pressed before it existed. */
  const adoptRunId = (id: string) => {
    activeRunIdRef.current = id;
    if (!stopRequestedRef.current) return;
    stopRequestedRef.current = false;
    void stopDurableRun(id);
  };

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
            tokenSavers: [],
            routingTrace: null,
          };
        })()
      : await executeDurableChat({
          sessionId,
          messageId: assistantMessageId,
          fetchOptions,
          signal,
          onStreamText: updateStreamingText,
          onRunId: adoptRunId,
          // The worker runs `load_skill` itself now, and the enabled set is
          // partly this browser's stored preferences.
          enabledSkillIds: [...getEnabledSkillIds(session.skillOverrides, readSkillPreferences())],
        });
    recordRoutingTraceEvent(recordHarnessEvent, sessionId, assistantMessageId, result.routingTrace);
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
          tokenSavers: result.tokenSavers,
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
                tokenSavers: result.tokenSavers,
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
          onRunId: adoptRunId,
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
    // A failed run is exactly when the routing story matters most.
    recordRoutingTraceEvent(recordHarnessEvent, sessionId, currentRunId, readRoutingTraceFromError(error));
    finalizeStreamError(
      sessionId,
      currentRunId,
      error,
      updateSession,
      recordHarnessEvent,
      setChatError,
    );
  } finally {
    setSending(false);
    setStreamingMessageId("");
    setStreamingText("");
    abortRef.current = null;
    // Nothing is watching it any more. Leaving the id here told run recovery to
    // keep skipping a run that had already finished.
    activeRunIdRef.current = null;
    // Taking the card down is the hook's job, derived from `isSending` — doing
    // it here made it this path's job, and every path that skipped this line
    // left the card on screen for good.
    const next = dequeueNext(sessionId);
    if (next) replayQueuedMessage(next);
  }
}

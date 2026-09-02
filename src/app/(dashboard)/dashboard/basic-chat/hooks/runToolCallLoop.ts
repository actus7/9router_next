import {
  buildChatFetchOptions,
  buildRequestMessages,
} from "./buildChatRequest";
import { executeChatFetch } from "./consumeSSEStream";
import { executeRuntimeToolCall } from "./executeRuntimeToolCall";
import { createAssistantMessage } from "./prepareChatMessages";
import type { AgentActivity } from "./useSendMessageTypes";
import type {
  ChatMessage,
  ChatSession,
  NormalizedModel,
  ToolCall,
} from "../types";

interface RunToolCallLoopParams {
  sessionId: string;
  model: NormalizedModel;
  session: ChatSession;
  assistantMessage: ChatMessage;
  assistantMessageId: string;
  nextMessages: ChatMessage[];
  resultText: string;
  initialToolCalls: ToolCall[];
  effectiveSystemPrompt: string;
  temperature: number;
  reasoningEffort: "low" | "medium" | "high" | null;
  apiKey: string;
  signal: AbortSignal;
  runtimeTools: readonly object[];
  enabledToolNames: Set<string>;
  updateSession: (
    sessionId: string,
    updater: (session: ChatSession) => ChatSession,
  ) => void;
  recordHarnessEvent: (
    sessionId: string,
    type: string,
    data: Record<string, unknown>,
  ) => void;
  setLiveActivities: React.Dispatch<React.SetStateAction<AgentActivity[]>>;
  setStreamingMessageId: React.Dispatch<React.SetStateAction<string>>;
  setStreamingText: React.Dispatch<React.SetStateAction<string>>;
}

/**
 * Runs the bounded (max 8 steps) tool-call -> continuation loop after an
 * assistant turn requests one or more tools. Extracted from useSendMessage
 * to keep that hook under the project's file-size gate. Returns the id of
 * the final run (assistant message) produced by the loop.
 */
export async function runToolCallLoop(
  params: RunToolCallLoopParams,
): Promise<string> {
  const {
    sessionId,
    model,
    session,
    assistantMessage,
    assistantMessageId,
    nextMessages,
    resultText,
    initialToolCalls,
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
  } = params;

  let conversation: ChatMessage[] = [
    ...nextMessages.slice(0, -1),
    {
      ...assistantMessage,
      content: resultText,
      status: "done",
      toolCalls: initialToolCalls,
    },
  ];
  let pendingCalls = initialToolCalls;
  let runId = assistantMessageId;

  const pluginSettings = session.pluginSettings ?? {};
  const maxToolSteps = Math.max(
    1,
    Math.min(8, pluginSettings.maxToolSteps ?? 8),
  );
  const maxSubagentCalls = Math.max(
    0,
    Math.min(4, pluginSettings.maxSubagentCalls ?? 2),
  );
  let usedSubagentCalls = 0;
  for (
    let step = 0;
    step < maxToolSteps && pendingCalls.length > 0;
    step += 1
  ) {
    updateSession(sessionId, (s) => ({
      ...s,
      messages: s.messages.map((message) =>
        message.id === runId
          ? {
              ...message,
              toolCalls: pendingCalls.map((call) => ({
                ...call,
                status: "running" as const,
              })),
            }
          : message,
      ),
      updatedAt: new Date().toISOString(),
    }));
    const toolMessages = await Promise.all(
      pendingCalls.map(async (call) => {
        try {
          if (
            call.name === "delegate_task" &&
            usedSubagentCalls++ >= maxSubagentCalls
          ) {
            return {
              id: crypto.randomUUID(),
              role: "tool",
              toolCallId: call.id,
              content: JSON.stringify({
                ok: false,
                error: "Subagent call limit reached for this run",
              }),
              createdAt: new Date().toISOString(),
              status: "error" as const,
            };
          }
          const content = await executeRuntimeToolCall(call, {
            apiKey,
            model,
            signal,
            enabledToolNames,
            mcpServers: session.mcpServers,
            sessionId: session.id,
            webSearchMaxResults: pluginSettings.webSearchMaxResults,
            webFetchMaxCharacters: pluginSettings.webFetchMaxCharacters,
          });
          const failed = content.includes('"ok":false');
          setLiveActivities((activities) =>
            activities.map((activity) =>
              activity.id === call.id
                ? {
                    ...activity,
                    detail: failed ? "Não concluída" : "Concluída",
                    state: failed ? "error" : "done",
                  }
                : activity,
            ),
          );
          updateSession(sessionId, (s) => ({
            ...s,
            messages: s.messages.map((message) =>
              message.id === runId
                ? {
                    ...message,
                    toolCalls: message.toolCalls?.map((toolCall) =>
                      toolCall.id === call.id
                        ? {
                            ...toolCall,
                            result: content,
                            status: failed ? "error" : "done",
                          }
                        : toolCall,
                    ),
                  }
                : message,
            ),
            updatedAt: new Date().toISOString(),
          }));
          recordHarnessEvent(sessionId, "tool/result", {
            runId,
            toolCallId: call.id,
            name: call.name,
            content,
          });
          return {
            id: crypto.randomUUID(),
            role: "tool",
            toolCallId: call.id,
            content,
            createdAt: new Date().toISOString(),
            status: failed ? ("error" as const) : ("done" as const),
          };
        } catch (error) {
          const content = JSON.stringify({
            ok: false,
            error:
              error instanceof Error ? error.message : "Tool execution failed",
          });
          setLiveActivities((activities) =>
            activities.map((activity) =>
              activity.id === call.id
                ? { ...activity, detail: "Não concluída", state: "error" }
                : activity,
            ),
          );
          recordHarnessEvent(sessionId, "tool/result", {
            runId,
            toolCallId: call.id,
            name: call.name,
            content,
          });
          return {
            id: crypto.randomUUID(),
            role: "tool",
            toolCallId: call.id,
            content,
            createdAt: new Date().toISOString(),
            status: "error" as const,
          };
        }
      }),
    );
    conversation = conversation.map((message) =>
      message.id === runId
        ? {
            ...message,
            toolCalls: pendingCalls.map((call, index) => ({
              ...call,
              result: toolMessages[index].content,
              status:
                toolMessages[index].status === "error"
                  ? ("error" as const)
                  : ("done" as const),
            })),
          }
        : message,
    );
    conversation = [...conversation, ...toolMessages];
    updateSession(sessionId, (s) => ({
      ...s,
      messages: conversation,
      updatedAt: new Date().toISOString(),
    }));

    const continuation = createAssistantMessage(model);
    setLiveActivities((activities) => [
      ...activities,
      {
        id: continuation.id,
        label: "Sintetizando",
        detail: model.name,
        state: "running",
      },
    ]);
    conversation = [...conversation, continuation];
    updateSession(sessionId, (s) => ({
      ...s,
      messages: conversation,
      updatedAt: new Date().toISOString(),
    }));
    recordHarnessEvent(sessionId, "run/start", {
      runId: continuation.id,
      modelId: model.id,
      providerId: model.providerId,
      parentRunId: runId,
    });
    setStreamingMessageId(continuation.id);
    setStreamingText("");
    const continuationResult = await executeChatFetch(
      "/api/v1/chat/completions",
      buildChatFetchOptions(
        model,
        buildRequestMessages(
          conversation,
          continuation.id,
          effectiveSystemPrompt,
        ),
        temperature,
        apiKey,
        signal,
        runtimeTools,
        reasoningEffort,
      ),
      (text) => {
        setStreamingText(text);
        setLiveActivities((activities) =>
          activities.map((activity) =>
            activity.id === continuation.id
              ? { ...activity, label: "Respondendo", state: "streaming" }
              : activity,
          ),
        );
        updateSession(sessionId, (s) => ({
          ...s,
          messages: s.messages.map((message) =>
            message.id === continuation.id
              ? { ...message, content: text, status: "streaming" }
              : message,
          ),
          updatedAt: new Date().toISOString(),
        }));
      },
    );
    conversation = conversation.map((message) =>
      message.id === continuation.id
        ? {
            ...message,
            content: continuationResult.text,
            status: "done",
            toolCalls: continuationResult.toolCalls,
            tokenUsage: continuationResult.usage ?? message.tokenUsage,
          }
        : message,
    );
    updateSession(sessionId, (s) => ({
      ...s,
      messages: conversation,
      updatedAt: new Date().toISOString(),
    }));
    setLiveActivities((activities) =>
      activities.map((activity) =>
        activity.id === continuation.id
          ? { ...activity, detail: "Concluída", state: "done" }
          : activity,
      ),
    );
    if (continuationResult.reasoning) {
      recordHarnessEvent(sessionId, "assistant/reasoning", {
        runId: continuation.id,
        content: continuationResult.reasoning,
      });
    }
    recordHarnessEvent(sessionId, "assistant/message", {
      runId: continuation.id,
      content: continuationResult.text,
    });
    if (continuationResult.toolCalls.length === 0) {
      recordHarnessEvent(sessionId, "run/complete", {
        runId: continuation.id,
        ...(continuationResult.usage
          ? { usage: continuationResult.usage }
          : {}),
      });
    }
    pendingCalls = continuationResult.toolCalls;
    runId = continuation.id;
    for (const toolCall of pendingCalls) {
      recordHarnessEvent(sessionId, "tool/call", {
        runId,
        toolCallId: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
      });
    }
  }

  return runId;
}

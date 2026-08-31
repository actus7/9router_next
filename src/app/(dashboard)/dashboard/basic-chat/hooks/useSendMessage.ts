"use client";

import { useCallback, useRef, useState } from "react";
import { translate } from "@/i18n/runtime";
import { buildUserContent, createId, makeSessionTitle, readAssistantText, textValue } from "../chatFormatUtils";
import type { ChatAttachment, ChatMessage, ChatSession, NormalizedModel, ProviderGroup, SendMessageOptions } from "../types";

interface UseSendMessageArgs {
  activeModel: NormalizedModel | null;
  activeProviderGroup: ProviderGroup | null;
  activeSessionId: string;
  setActiveSessionId: React.Dispatch<React.SetStateAction<string>>;
  sessions: ChatSession[];
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  updateSession: (sessionId: string, updater: (session: ChatSession) => ChatSession) => void;
  ensureSessionForModel: (model: NormalizedModel | null) => ChatSession | undefined;
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  attachments: ChatAttachment[];
  setAttachments: React.Dispatch<React.SetStateAction<ChatAttachment[]>>;
  systemPrompt: string;
  temperature: number;
  apiKey: string;
  recordHarnessEvent: (sessionId: string, type: string, data: Record<string, unknown>) => void;
  setBlockedModelIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setModelMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export interface UseSendMessageReturn {
  chatError: string;
  setChatError: React.Dispatch<React.SetStateAction<string>>;
  isSending: boolean;
  streamingMessageId: string;
  streamingText: string;
  copiedMessageId: string;
  canSend: boolean;
  sendMessage: (options?: SendMessageOptions) => Promise<void>;
  handleStop: () => void;
  resetStream: () => void;
  handleCopyMessage: (messageId: string, content: string) => Promise<void>;
  handleRetryMessage: (messageId: string) => void;
  handleFeedback: (messageId: string, feedback: "up" | "down") => void;
  handleExportConversation: (format: "json" | "markdown") => void;
  handleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

// Owns the streaming chat request lifecycle: building the request, reading
// the SSE stream into the active session's assistant message, retry/stop/
// feedback/export actions, and the transient error/streaming UI state.
export function useSendMessage({
  activeModel, activeProviderGroup, activeSessionId, setActiveSessionId, sessions, setSessions,
  updateSession, ensureSessionForModel, draft, setDraft, attachments, setAttachments,
  systemPrompt, temperature, apiKey, recordHarnessEvent, setBlockedModelIds, setModelMenuOpen,
}: UseSendMessageArgs): UseSendMessageReturn {
  const [chatError, setChatError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const canSend = !isSending && !!activeModel && (draft.trim().length > 0 || attachments.length > 0);

  const resetStream = useCallback(() => {
    setStreamingMessageId("");
    setStreamingText("");
  }, []);

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const finalizeSessionTitle = (sessionId: string, titleSeed: string) => {
    const title = makeSessionTitle(titleSeed);
    updateSession(sessionId, (session) => ({
      ...session,
      title: session.title === (translate("New conversation") || "New conversation") ? title : session.title,
      updatedAt: new Date().toISOString(),
    }));
  };

  async function sendMessage(options?: SendMessageOptions) {
    const model = activeModel || activeProviderGroup?.models?.[0] || null;
    if (!model) return;

    const userText = (options?.text ?? draft).trim();
    const messageAttachments = options?.attachments ?? attachments;
    if (!userText && messageAttachments.length === 0) return;

    let sessionId = activeSessionId;
    let session = sessions.find((item) => item.id === sessionId);
    if (!session) {
      const newSession = ensureSessionForModel(model);
      if (!newSession) return;
      session = newSession;
      sessionId = newSession.id;
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(sessionId);
    }

    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: userText,
      attachments: messageAttachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        type: attachment.type,
        dataUrl: attachment.dataUrl,
      })),
      createdAt: new Date().toISOString(),
    };

    const assistantMessageId = createId();
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      status: "streaming",
      modelId: model.id,
      modelName: model.name,
      providerId: model.providerId,
      providerName: model.providerName,
    };

    const nextMessages = [...(options?.baseMessages ?? session.messages ?? []), userMessage, assistantMessage];
    recordHarnessEvent(sessionId, "user/message", { messageId: userMessage.id, content: userText });
    recordHarnessEvent(sessionId, "run/start", { runId: assistantMessageId, modelId: model.id, providerId: model.providerId });
    setSessions((prev) => prev.map((item) => (item.id === sessionId ? {
      ...item,
      providerId: model.providerId,
      providerName: model.providerName,
      modelId: model.id,
      modelName: model.name,
      messages: nextMessages,
      updatedAt: new Date().toISOString(),
        title: item.title === (translate("New conversation") || "New conversation") ? makeSessionTitle(userText) : item.title,
    } : item)));
    if (!options) {
      setDraft("");
      setAttachments([]);
    }
    setChatError("");
    setIsSending(true);
    setStreamingMessageId(assistantMessageId);
    setStreamingText("");
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const requestMessages = nextMessages
      .filter((message) => !(message.role === "assistant" && message.id === assistantMessageId))
      .map((message) => ({
        role: message.role,
        content: message.role === "user" ? buildUserContent(message) : message.content,
      }));

    // Prepend system prompt if set
    if (systemPrompt.trim()) {
      requestMessages.unshift({ role: "system", content: systemPrompt.trim() });
    }

    try {
      const response = await fetch("/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: model.requestModel || model.id,
          messages: requestMessages,
          stream: true,
          temperature,
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as Record<string, unknown>;
        const requestError = new Error(textValue(errorData.error || errorData.message || `Request failed (${response.status})`)) as Error & { status?: number };
        requestError.status = response.status;
        throw requestError;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        const data = await response.json().catch(() => ({})) as Record<string, unknown>;
        const fallbackText = textValue(((data?.choices as Array<Record<string, unknown>> | undefined)?.[0] as Record<string, unknown> | undefined)?.message || data?.output_text || data?.error || data?.message || "");
        updateSession(sessionId, (currentSession) => ({
          ...currentSession,
          messages: currentSession.messages.map((message) => (message.id === assistantMessageId ? { ...message, content: fallbackText, status: "done" } : message)),
          updatedAt: new Date().toISOString(),
        }));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;

          try {
            const chunk = JSON.parse(payload);
            const text = readAssistantText(chunk);
            if (!text) continue;

            assistantText += text;
            setStreamingText(assistantText);
            updateSession(sessionId, (currentSession) => ({
              ...currentSession,
              messages: currentSession.messages.map((message) => (message.id === assistantMessageId ? { ...message, content: assistantText, status: "streaming" } : message)),
              updatedAt: new Date().toISOString(),
            }));
          } catch {
            // Ignore malformed chunks.
          }
        }
      }

      updateSession(sessionId, (currentSession) => ({
        ...currentSession,
        messages: currentSession.messages.map((message) => (message.id === assistantMessageId ? { ...message, content: assistantText || message.content, status: "done" } : message)),
        updatedAt: new Date().toISOString(),
      }));
      recordHarnessEvent(sessionId, "run/end", { runId: assistantMessageId, status: "completed", messageId: assistantMessageId });
      finalizeSessionTitle(sessionId, userText);
    } catch (error: unknown) {
      if ((error as Error).name !== "AbortError") {
        const errorText = textValue((error as Error)?.message || error);
        updateSession(sessionId, (currentSession) => ({
          ...currentSession,
          messages: currentSession.messages.map((message) => (message.id === assistantMessageId ? { ...message, content: message.content || `Error: ${errorText}`, status: "error" } : message)),
          updatedAt: new Date().toISOString(),
        }));
        setChatError(errorText || "Failed to send message.");
        recordHarnessEvent(sessionId, "run/end", { runId: assistantMessageId, status: "failed", error: errorText });
        const status = (error as Error & { status?: number }).status;
        if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
          setBlockedModelIds((previous) => new Set(previous).add(model.id));
          setModelMenuOpen(true);
        }
      }
    } finally {
      setIsSending(false);
      setStreamingMessageId("");
      setStreamingText("");
      abortRef.current = null;
    }
  }

  const handleCopyMessage = useCallback(async (messageId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(textValue(content));
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(""), 2000);
    } catch {
      // Ignore clipboard errors
    }
  }, []);

  const handleRetryMessage = useCallback((messageId: string) => {
    const session = sessions.find((s) => s.id === activeSessionId);
    if (!session || !activeModel) return;

    const msgIndex = session.messages.findIndex((m) => m.id === messageId);
    if (msgIndex < 0) return;

    const userIndex = [...session.messages.slice(0, msgIndex)].map((message) => message.role).lastIndexOf("user");
    const userMsg = userIndex >= 0 ? session.messages[userIndex] : undefined;
    if (!userMsg || userMsg.role !== "user") return;

    // Replay from a stable snapshot rather than setting a draft and relying on
    // a timer (which could submit stale React state or duplicate a turn).
    void sendMessage({
      text: textValue(userMsg.content),
      attachments: userMsg.attachments,
      baseMessages: session.messages.slice(0, userIndex),
    });
  }, [sessions, activeSessionId, activeModel]);

  const handleFeedback = useCallback((messageId: string, feedback: "up" | "down") => {
    updateSession(activeSessionId, (session) => ({
      ...session,
      messages: session.messages.map((m) =>
        m.id === messageId ? { ...m, feedback: m.feedback === feedback ? null : feedback } : m
      ),
    }));
  }, [activeSessionId, updateSession]);

  const handleExportConversation = useCallback((format: "json" | "markdown") => {
    const session = sessions.find((s) => s.id === activeSessionId);
    if (!session) return;

    let content: string;
    let filename: string;
    let mimeType: string;

    if (format === "json") {
      content = JSON.stringify(session, null, 2);
      filename = `${session.title.replace(/[^a-z0-9]/gi, "_")}.json`;
      mimeType = "application/json";
    } else {
      content = `# ${session.title}\n\n`;
      content += `Latest model: ${session.modelName} (${session.providerName})\n`;
      content += `Created: ${new Date(session.createdAt).toLocaleString()}\n\n---\n\n`;
      for (const msg of session.messages) {
        const role = msg.role === "user" ? "**You**" : `**${msg.modelName || session.modelName}**`;
        content += `${role}:\n${textValue(msg.content)}\n\n`;
      }
      filename = `${session.title.replace(/[^a-z0-9]/gi, "_")}.md`;
      mimeType = "text/markdown";
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [sessions, activeSessionId]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) void sendMessage();
    }
  };

  return {
    chatError, setChatError, isSending, streamingMessageId, streamingText, copiedMessageId, canSend,
    sendMessage, handleStop, resetStream, handleCopyMessage, handleRetryMessage, handleFeedback,
    handleExportConversation, handleKeyDown,
  };
}

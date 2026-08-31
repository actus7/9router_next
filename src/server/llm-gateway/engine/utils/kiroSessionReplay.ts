import { MEMORY_CONFIG } from "../config/runtimeConfig";

interface SessionEntry {
  sessionStart: Record<string, unknown>;
  modelId: string;
  systemPrompt: string;
  lastUsed: number;
}

const sessionStartStore = new Map<string, SessionEntry>();
const MAX_SESSION_STARTS = 5000;

function clone(value: unknown): Record<string, unknown> | null {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

function sessionKey(connectionId: string, conversationId: string) {
  return `${connectionId || ""}:${conversationId || ""}`;
}

function ensureUserMessageModelId(message: Record<string, unknown>, modelId: string) {
  const uim = message?.userInputMessage as Record<string, unknown> | undefined;
  if (uim && !uim.modelId && modelId) {
    uim.modelId = modelId;
  }
  return message;
}

function ensureHistoryModelIds(history: Record<string, unknown>[], modelId: string) {
  for (const item of history || []) {
    ensureUserMessageModelId(item, modelId);
  }
  return history;
}

function prefixUserMessage(message: Record<string, unknown>, contentPrefix: string, modelId: string) {
  const out = (clone(message) || { userInputMessage: { content: "" } }) as Record<string, unknown>;
  if (!out.userInputMessage) out.userInputMessage = { content: "" };
  ensureUserMessageModelId(out, modelId);
  if (contentPrefix) {
    const uim = out.userInputMessage as Record<string, unknown>;
    const content = (uim.content as string) || "";
    uim.content = content
      ? `${contentPrefix}\n\n${content}`
      : contentPrefix;
  }
  return out;
}

function findFirstUserIndex(history: Record<string, unknown>[]) {
  return history.findIndex((item) => (item?.userInputMessage as Record<string, unknown>)?.userInputMessage);
}

function hasToolResults(message: Record<string, unknown>) {
  const uim = message?.userInputMessage as Record<string, unknown> | undefined;
  const ctx = uim?.userInputMessageContext as Record<string, unknown> | undefined;
  return !!(ctx?.toolResults as unknown[])?.length;
}

function canReplaceSessionStart(history: Record<string, unknown>[], firstUserIndex: number) {
  return firstUserIndex === 0 && !hasToolResults(history[firstUserIndex]);
}

function rememberSessionStart(key: string, entry: Omit<SessionEntry, "lastUsed">) {
  if (sessionStartStore.size >= MAX_SESSION_STARTS) {
    sessionStartStore.delete(sessionStartStore.keys().next().value!);
  }
  sessionStartStore.set(key, { ...entry, lastUsed: Date.now() });
}

/**
 * Preserve Kiro cacheability by freezing the first user message (`msg0`) for a
 * session, replaying that exact message as the first history user on later
 * turns, and injecting volatile current-time context only into the current turn.
 */
export function applyKiroSessionReplay({
  conversationId,
  connectionId,
  modelId,
  systemPrompt = "",
  contentPrefix = "",
  currentContentPrefix = "",
  history = [],
  currentMessage,
}: {
  conversationId?: string;
  connectionId?: string;
  modelId?: string;
  systemPrompt?: string;
  contentPrefix?: string;
  currentContentPrefix?: string;
  history?: Record<string, unknown>[];
  currentMessage?: Record<string, unknown>;
} = {}) {
  const key = sessionKey(connectionId || "", conversationId || "");
  const existing = conversationId ? sessionStartStore.get(key) : null;
  const baseHistory = (clone(history) || []) as Record<string, unknown>[];
  const baseCurrent = (clone(currentMessage) || { userInputMessage: { content: "" } }) as Record<string, unknown>;

  if (existing && existing.modelId === modelId && existing.systemPrompt === systemPrompt) {
    existing.lastUsed = Date.now();
    const firstUserIndex = findFirstUserIndex(baseHistory);
    const sessionStart = ensureUserMessageModelId(clone(existing.sessionStart)!, modelId || "");
    if (canReplaceSessionStart(baseHistory, firstUserIndex)) {
      baseHistory[firstUserIndex] = sessionStart;
    } else {
      baseHistory.unshift(sessionStart);
      if (baseHistory.length === 1) {
        baseHistory.push({ assistantResponseMessage: { content: "..." } });
      }
    }
    return {
      history: ensureHistoryModelIds(baseHistory, modelId || ""),
      currentMessage: prefixUserMessage(baseCurrent, currentContentPrefix, modelId || ""),
      replayed: true,
    };
  }

  const firstUserIndex = findFirstUserIndex(baseHistory);
  let sessionStart: Record<string, unknown>;
  let nextCurrent = ensureUserMessageModelId(baseCurrent, modelId || "");
  if (canReplaceSessionStart(baseHistory, firstUserIndex)) {
    sessionStart = prefixUserMessage(baseHistory[firstUserIndex], contentPrefix, modelId || "");
    baseHistory[firstUserIndex] = clone(sessionStart)!;
    nextCurrent = prefixUserMessage(baseCurrent, currentContentPrefix, modelId || "");
  } else if (firstUserIndex >= 0) {
    sessionStart = prefixUserMessage(
      { userInputMessage: { content: "", modelId } },
      contentPrefix,
      modelId || ""
    );
    baseHistory.unshift(clone(sessionStart)!);
    nextCurrent = prefixUserMessage(baseCurrent, currentContentPrefix, modelId || "");
  } else {
    sessionStart = prefixUserMessage(baseCurrent, contentPrefix, modelId || "");
    nextCurrent = clone(sessionStart)!;
  }

  if (conversationId) {
    rememberSessionStart(key, {
      sessionStart: clone(sessionStart)!,
      modelId: modelId || "",
      systemPrompt,
    });
  }

  return {
    history: ensureHistoryModelIds(baseHistory, modelId || ""),
    currentMessage: nextCurrent,
    replayed: false,
  };
}

function clearKiroSessionReplayStore() {
  sessionStartStore.clear();
}

const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of sessionStartStore) {
    if (now - entry.lastUsed > MEMORY_CONFIG.sessionTtlMs) sessionStartStore.delete(key);
  }
}, MEMORY_CONFIG.sessionCleanupIntervalMs);
if (cleanup.unref) cleanup.unref();

import type { ChatFetchError, ChatFetchResult } from "./consumeSSEStream";
import type { TokenUsage } from "../types";
import { normalizeTokenSavers } from "@/shared/chat/tokenSavers";

/** The run row as `/api/harness/runs/[runId]/stream` serializes it. */
interface RunFrame {
  id: string;
  status: "running" | "completed" | "failed" | "stopped";
  partialText: string;
  reasoning: string | null;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  usage: TokenUsage | null;
  tokenSavers?: string[];
  error: string | null;
}

export interface DurableChatOptions {
  sessionId: string;
  messageId: string;
  /** Built by `buildChatFetchOptions`, so the payload matches the direct path exactly. */
  fetchOptions: RequestInit;
  signal: AbortSignal;
  onStreamText: (text: string) => void;
  /** Called once the run exists, so the caller can stop it on purpose later. */
  onRunId?: (runId: string) => void;
  /**
   * Skills this session has enabled.
   *
   * The worker runs `load_skill` now and cannot work this out on its own —
   * part of the answer is in this browser's `localStorage` preferences — so it
   * is stated here rather than guessed there.
   */
  enabledSkillIds?: readonly string[];
}

/**
 * Sends a message as a run that outlives this tab.
 *
 * Same contract as `executeChatFetch` so it drops into the same call sites: it
 * resolves with the finished answer and throws the same shape on failure. The
 * difference is where the work happens — the server owns the provider call, so
 * aborting `signal` only stops *watching*. Closing the laptop does the same,
 * which is the whole point: the answer is waiting on the next visit.
 */
export async function executeDurableChat(options: DurableChatOptions): Promise<ChatFetchResult> {
  const headers = new Headers(options.fetchOptions.headers);
  const body = JSON.parse(String(options.fetchOptions.body ?? "{}")) as Record<string, unknown>;
  const authorization = headers.get("Authorization");

  // Deliberately not given `options.signal`: leaving the screen must not
  // cancel the request that starts the durable work, and a cancelled POST can
  // still create a run whose id never reaches the client — one nothing can
  // stop. Only the watching below is abortable.
  const created = await fetch("/api/harness/runs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify({
      sessionId: options.sessionId,
      messageId: options.messageId,
      body,
      ...(options.enabledSkillIds ? { enabledSkillIds: options.enabledSkillIds } : {}),
    }),
  });

  if (!created.ok) {
    const detail = (await created.json().catch(() => ({}))) as Record<string, unknown>;
    const error = new Error(
      typeof detail.error === "string" ? detail.error : `Could not start the run (${created.status})`,
    ) as ChatFetchError;
    error.status = created.status;
    throw error;
  }

  const { runId } = (await created.json()) as { runId: string };
  options.onRunId?.(runId);

  return await watchDurableRun(runId, options);
}

export interface WatchDurableRunOptions {
  signal?: AbortSignal;
  onStreamText: (text: string) => void;
}

/**
 * Follows a run that is already going.
 *
 * Exported because starting a run and watching one are separate acts: a tab
 * that comes back after being closed never started this run, it only needs to
 * pick it up. Without that, a run still in flight when the user left would
 * simply never be read again.
 */
export async function watchDurableRun(
  runId: string,
  options: WatchDurableRunOptions,
): Promise<ChatFetchResult> {
  const response = await fetch(`/api/harness/runs/${encodeURIComponent(runId)}/stream`, {
    headers: { Accept: "text/event-stream" },
    signal: options.signal,
  });
  if (!response.ok || !response.body) {
    const error = new Error(`Could not watch the run (${response.status})`) as ChatFetchError;
    error.status = response.status;
    throw error;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let last: RunFrame | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      try {
        last = JSON.parse(trimmed.slice(5).trim()) as RunFrame;
      } catch {
        continue;
      }
      options.onStreamText(last.partialText);
      if (last.status !== "running") break;
    }
    if (last && last.status !== "running") break;
  }

  if (!last) {
    throw new Error("The run ended without reporting a result.") as ChatFetchError;
  }
  if (last.status === "failed") {
    throw new Error(last.error || "The run failed.") as ChatFetchError;
  }
  if (last.status === "running") {
    // The stream ended without the run reaching a terminal state — the row was
    // deleted under the watcher, or the server hit its own watch ceiling. The
    // text in hand is a fragment, and returning it as a result would file a
    // truncated answer as a finished one, silently.
    const error = new Error(
      "The answer was interrupted before it finished. Retry to continue.",
    ) as ChatFetchError;
    throw error;
  }
  if (last.status === "stopped") {
    // Same shape the direct path produces for a user stop, so the caller's
    // existing AbortError branch keeps the partial text and settles the message.
    throw new DOMException("The run was stopped.", "AbortError");
  }

  return {
    text: last.partialText,
    streamed: true,
    // Optional on the wire: a run with no tool calls serializes the column as
    // null, and assuming an array here turned that into a TypeError that the
    // caller could only read as "the run failed".
    toolCalls: (last.toolCalls ?? []).map((call) => ({ ...call, status: "pending" as const })),
    reasoning: last.reasoning || "",
    usage: last.usage,
    tokenSavers: normalizeTokenSavers(last.tokenSavers),
    routingTrace: null,
  };
}

/** Marks a run stopped. Only an explicit stop calls this — navigating away must not. */
export async function stopDurableRun(runId: string): Promise<void> {
  await fetch("/api/harness/runs", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId }),
  }).catch(() => undefined);
}

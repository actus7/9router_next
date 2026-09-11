"use client";

import { useCallback, useMemo } from "react";

import type { ChatSession } from "../types";

export const DEFAULT_TEMPERATURE = 0.7;

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;
type ReasoningEffort = "low" | "medium" | "high" | null;

export interface UseSessionInferenceReturn {
  systemPrompt: string;
  setSystemPrompt: Setter<string>;
  temperature: number;
  setTemperature: Setter<number>;
  reasoningEffort: ReasoningEffort;
  setReasoningEffort: Setter<ReasoningEffort>;
}

/**
 * The inference settings of the conversation on screen.
 *
 * Reads and writes `ChatSession` rather than page state, so each conversation
 * keeps its own and they sync with it. The setters keep their old signatures
 * so nothing that edits them had to learn where they moved to.
 */
export function useSessionInference(
  session: ChatSession | undefined,
  updateSession: (id: string, updater: (session: ChatSession) => ChatSession) => void,
): UseSessionInferenceReturn {
  const sessionId = session?.id ?? "";

  const patch = useCallback(
    (change: (session: ChatSession) => Partial<ChatSession>) => {
      if (!sessionId) return;
      updateSession(sessionId, (current) => ({ ...current, ...change(current) }));
    },
    [sessionId, updateSession],
  );

  const setSystemPrompt = useCallback<Setter<string>>(
    (value) => patch((current) => ({
      systemPrompt: typeof value === "function" ? value(current.systemPrompt ?? "") : value,
    })),
    [patch],
  );

  const setTemperature = useCallback<Setter<number>>(
    (value) => patch((current) => ({
      temperature:
        typeof value === "function" ? value(current.temperature ?? DEFAULT_TEMPERATURE) : value,
    })),
    [patch],
  );

  const setReasoningEffort = useCallback<Setter<ReasoningEffort>>(
    (value) => patch((current) => ({
      reasoningEffort:
        typeof value === "function" ? value(current.reasoningEffort ?? null) : value,
    })),
    [patch],
  );

  return useMemo(
    () => ({
      systemPrompt: session?.systemPrompt ?? "",
      setSystemPrompt,
      temperature: session?.temperature ?? DEFAULT_TEMPERATURE,
      setTemperature,
      reasoningEffort: session?.reasoningEffort ?? null,
      setReasoningEffort,
    }),
    [session, setReasoningEffort, setSystemPrompt, setTemperature],
  );
}

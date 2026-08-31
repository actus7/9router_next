"use client";

import { useRef, useState } from "react";
import { getModelKind } from "@/shared/constants/models";
import { translate } from "@/i18n/runtime";
import { useNotificationStore } from "@/store/notificationStore";
import type { LiveModel, ModelDiagnostic } from "../types";

const TEST_TIMEOUT_SCHEDULE = [15000, 25000, 40000];
const MAX_BATCH_MODEL_TESTS = 25;

function isDefinitivelyUnavailableModel(result: ModelDiagnostic): boolean {
  if (result.ok) return false;
  if (result.status === 404) return true;
  return /(?:model .*?(?:not found|does not exist|unsupported|not available)|unknown model)/i.test(result.error || "");
}

interface UseModelTestingArgs {
  providerStorageAlias: string;
  providerId: string;
  models: LiveModel[];
  kiloFreeModels: LiveModel[];
  disabledModelIds: string[];
  onDisableModels: (ids: string[]) => Promise<void>;
}

export function useModelTesting({
  providerStorageAlias,
  providerId,
  models,
  kiloFreeModels,
  disabledModelIds,
  onDisableModels,
}: UseModelTestingArgs) {
  const notify = useNotificationStore();
  const [modelTestResults, setModelTestResults] = useState<Record<string, "ok" | "error">>({});
  const [modelsTestError, setModelsTestError] = useState<string>("");
  const [testingModelIds, setTestingModelIds] = useState<Set<string>>(() => new Set());
  const [testAllModels, setTestAllModels] = useState<{ running: boolean; results: ModelDiagnostic[] } | null>(null);
  const testAllAbortRef = useRef<AbortController | null>(null);

  // Ping one model, retrying only on timeout (not on definitive errors like 401/404),
  // with an increasing timeout per attempt.
  const pingModelWithRetry = async (
    modelId: string,
    onProgress: (diagnostic: ModelDiagnostic) => void,
    timeoutSchedule: readonly number[] = TEST_TIMEOUT_SCHEDULE,
    signal?: AbortSignal,
  ): Promise<ModelDiagnostic> => {
    let lastError = translate("Model is not reachable") || "Model is not reachable";
    let attemptsMade = 0;
    let lastStatus: number | undefined;
    for (let attempt = 0; attempt < timeoutSchedule.length; attempt++) {
      if (signal?.aborted) return { modelId, ok: false, state: "cancelled", error: "Test cancelled", attempts: attemptsMade, status: lastStatus };
      attemptsMade = attempt + 1;
      onProgress({ modelId, ok: false, state: attempt === 0 ? "testing" : "retrying", attempts: attemptsMade });
      try {
        const res = await fetch("/api/models/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}`, timeoutMs: timeoutSchedule[attempt] }),
          signal,
        });
        const data = await res.json();
        if (data.ok) return { modelId, ok: true, state: "passed", attempts: attemptsMade, latencyMs: data.latencyMs, status: data.status };
        lastError = data.error || lastError;
        lastStatus = data.status;
        if (data.isTimeout) {
          onProgress({ modelId, ok: false, state: "retrying", attempts: attemptsMade, status: lastStatus, error: lastError });
        }
        if (data.status === 429 || Number(data.status) >= 500) {
          onProgress({ modelId, ok: false, state: "retrying", attempts: attemptsMade, status: lastStatus, error: lastError });
          continue;
        }
        if (!data.isTimeout) break; // definitive failure — no point retrying
      } catch {
        if (signal?.aborted) return { modelId, ok: false, state: "cancelled", error: "Test cancelled", attempts: attemptsMade, status: lastStatus };
        lastError = translate("Network error") || "Network error";
        onProgress({ modelId, ok: false, state: "retrying", attempts: attemptsMade, error: lastError });
      }
    }
    return { modelId, ok: false, state: "failed", error: lastError, attempts: attemptsMade, status: lastStatus };
  };

  const handleTestAllModels = async () => {
    if (testAllAbortRef.current) return;
    const allModels = [
      ...models,
      ...kiloFreeModels.filter((fm) => !models.some((m) => m.id === fm.id)),
    ].filter((m) => { const k = getModelKind(m); return !k || k === "llm"; });
    const disabledSet = new Set(disabledModelIds);
    const modelIds = [...new Set(
      allModels
        .map((model) => model.id)
        .filter((modelId): modelId is string => typeof modelId === "string" && modelId.trim().length > 0)
        .filter((modelId) => !disabledSet.has(modelId)),
    )];
    if (modelIds.length === 0) return;
    const sampledModelIds = modelIds.slice(0, MAX_BATCH_MODEL_TESTS);
    if (modelIds.length > sampledModelIds.length) {
      notify.info(`Testing the first ${MAX_BATCH_MODEL_TESTS} of ${modelIds.length} enabled models. Test an individual model to inspect others.`);
    }

    setTestAllModels({
      running: true,
      results: sampledModelIds.map((modelId) => ({ modelId, ok: false, state: "queued", attempts: 0 })),
    });
    const controller = new AbortController();
    testAllAbortRef.current = controller;
    const maxConcurrentTests = providerId === "ollama" ? 1 : 3;
    const timeoutSchedule = providerId === "ollama" ? [25000] : TEST_TIMEOUT_SCHEDULE;
    const results: ModelDiagnostic[] = [];
    let nextIndex = 0;
    const runNext = async () => {
      while (nextIndex < sampledModelIds.length) {
        if (controller.signal.aborted) return;
        const modelId = sampledModelIds[nextIndex++];
        const updateProgress = (diagnostic: ModelDiagnostic) => {
          setTestAllModels((current) => current
            ? { ...current, results: current.results.map((item) => item.modelId === modelId ? diagnostic : item) }
            : current);
        };
      const result = await pingModelWithRetry(modelId, updateProgress, timeoutSchedule, controller.signal);
      if (result.state !== "cancelled") setModelTestResults((prev) => ({ ...prev, [modelId]: result.ok ? "ok" : "error" }));
      updateProgress(result);
        results.push(result);
      }
    };
    await Promise.all(Array.from({ length: Math.min(maxConcurrentTests, sampledModelIds.length) }, runNext));

    const unavailableIds = controller.signal.aborted ? [] : results.filter(isDefinitivelyUnavailableModel).map((result) => result.modelId);
    if (unavailableIds.length > 0) {
      await onDisableModels(unavailableIds);
    }
    setTestAllModels((prev) => prev ? { ...prev, running: false } : prev);
    testAllAbortRef.current = null;
  };

  const handleCancelTestAllModels = () => {
    const controller = testAllAbortRef.current;
    if (!controller) return;
    controller.abort();
    setTestAllModels((current) => current ? {
      running: false,
      results: current.results.map((result) => (
        result.state === "queued" || result.state === "testing" || result.state === "retrying"
          ? { ...result, state: "cancelled", error: "Test cancelled" }
          : result
      )),
    } : current);
  };

  const handleTestModel = async (modelId: string) => {
    if (testingModelIds.has(modelId)) return;
    setTestingModelIds((prev) => new Set(prev).add(modelId));
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}` }),
      });
      const data = await res.json();
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
      setModelsTestError(data.ok ? "" : (data.error || translate("Model is not reachable")));
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
      setModelsTestError(translate("Network error") || "Network error");
    } finally {
      setTestingModelIds((prev) => { const n = new Set(prev); n.delete(modelId); return n; });
    }
  };

  return {
    modelTestResults,
    setModelTestResults,
    modelsTestError,
    testingModelIds,
    testAllModels,
    setTestAllModels,
    handleTestAllModels,
    handleCancelTestAllModels,
    handleTestModel,
  };
}

export type UseModelTestingReturn = ReturnType<typeof useModelTesting>;

"use client";

import { probeModel } from "../../probeModel";
import { useRef, useState } from "react";
import { translate } from "@/i18n/runtime";
import { notify } from "@/store/notificationStore";
import { saveModelTestLatency } from "@/shared/utils/modelTestLatency";
import { eligibleTestIds, isDefinitivelyUnavailableModel, pingModelWithRetry } from "./modelTestHelpers";
import type { LiveModel, ModelDiagnostic, TestAllModelsState } from "../types";

const TEST_TIMEOUT_SCHEDULE = [15000, 25000, 40000];

interface UseModelTestingArgs {
  providerStorageAlias: string;
  providerId: string;
  models: LiveModel[];
  kiloFreeModels: LiveModel[];
  disabledModelIds: string[];
  onDisableModels: (ids: string[]) => Promise<void>;
}

export function useModelTesting({
  providerStorageAlias, providerId, models, kiloFreeModels, disabledModelIds, onDisableModels,
}: UseModelTestingArgs) {
  const [modelTestResults, setModelTestResults] = useState<Record<string, "ok" | "error">>({});
  const [modelsTestError, setModelsTestError] = useState<string>("");
  const [testingModelIds, setTestingModelIds] = useState<Set<string>>(() => new Set());
  const [testAllModels, setTestAllModels] = useState<TestAllModelsState | null>(null);
  const testAllAbortRef = useRef<AbortController | null>(null);

  /**
   * Tests every model handed to it. A large catalogue (Kilo Gateway returns
   * 381) takes a while, which is what Cancel and the background-running note
   * in the modal are for — the run is not capped.
   */
  const runBatch = async (modelIds: string[]) => {
    if (testAllAbortRef.current || modelIds.length === 0) return;
    setTestAllModels({
      running: true,
      results: modelIds.map((id) => ({ modelId: id, ok: false, state: "queued", attempts: 0 })),
    });

    const controller = new AbortController();
    testAllAbortRef.current = controller;
    const maxConcurrent = providerId === "ollama" ? 1 : 3;
    const schedule = providerId === "ollama" ? [25000] : TEST_TIMEOUT_SCHEDULE;
    const results: ModelDiagnostic[] = [];
    let nextIndex = 0;
    const runNext = async () => {
      while (nextIndex < modelIds.length) {
        if (controller.signal.aborted) return;
        const modelId = modelIds[nextIndex++];
        const updateProgress = (d: ModelDiagnostic) => setTestAllModels((c) => c ? { ...c, results: c.results.map((i) => i.modelId === modelId ? d : i) } : c);
        const result = await pingModelWithRetry(providerStorageAlias, modelId, updateProgress, schedule, controller.signal);
        if (result.ok) saveModelTestLatency(providerStorageAlias, modelId, result.latencyMs);
        if (result.state !== "cancelled") setModelTestResults((prev) => ({ ...prev, [modelId]: result.ok ? "ok" : "error" }));
        updateProgress(result);
        results.push(result);
      }
    };
    await Promise.all(Array.from({ length: Math.min(maxConcurrent, modelIds.length) }, runNext));

    const unavailableIds = controller.signal.aborted ? [] : results.filter(isDefinitivelyUnavailableModel).map((r) => r.modelId);
    if (unavailableIds.length > 0) await onDisableModels(unavailableIds);
    // Mark them where the user can see it. The run turning models off on its
    // own is the part of this screen nobody could explain from the UI.
    setTestAllModels((prev) => prev ? {
      ...prev,
      running: false,
      results: unavailableIds.length === 0
        ? prev.results
        : prev.results.map((r) => unavailableIds.includes(r.modelId) ? { ...r, autoDisabled: true } : r),
    } : prev);
    testAllAbortRef.current = null;
    if (!controller.signal.aborted) {
      const passed = results.filter((r) => r.state === "passed").length;
      const failed = results.length - passed;
      notify.success(`${passed} ${translate("passed") || "passed"}, ${failed} ${translate("failed") || "failed"}`, translate("Model test finished") || "Model test finished");
    }
  };

  const handleTestAllModels = async () => {
    await runBatch(eligibleTestIds(models, kiloFreeModels.filter((fm) => !models.some((m) => m.id === fm.id)), disabledModelIds));
  };

  const handleCancelTestAllModels = () => {
    const controller = testAllAbortRef.current;
    if (!controller) return;
    controller.abort();
    setTestAllModels((current) => current ? {
      ...current,
      running: false,
      results: current.results.map((r) => r.state === "queued" || r.state === "testing" || r.state === "retrying" ? { ...r, state: "cancelled", error: "Test cancelled" } : r),
    } : current);
  };

  const handleTestModel = async (modelId: string) => {
    if (testingModelIds.has(modelId)) return;
    setTestingModelIds((prev) => new Set(prev).add(modelId));
    try {
      const result = await probeModel(`${providerStorageAlias}/${modelId}`);
      if (result.status === "ok") saveModelTestLatency(providerStorageAlias, modelId, result.latencyMs);
      setModelTestResults((prev) => ({ ...prev, [modelId]: result.status }));
      setModelsTestError(result.status === "ok" ? "" : (result.error || translate("Model is not reachable") || "Model is not reachable"));
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
      setModelsTestError(translate("Network error") || "Network error");
    } finally { setTestingModelIds((prev) => { const n = new Set(prev); n.delete(modelId); return n; }); }
  };

  return {
    modelTestResults, setModelTestResults, modelsTestError, testingModelIds,
    testAllModels, setTestAllModels, handleTestAllModels,
    handleCancelTestAllModels, handleTestModel,
  };
}

export type UseModelTestingReturn = ReturnType<typeof useModelTesting>;

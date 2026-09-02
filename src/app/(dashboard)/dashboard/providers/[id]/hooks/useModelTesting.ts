"use client";

import { useRef, useState } from "react";
import { getModelKind } from "@/shared/constants/models";
import { translate } from "@/i18n/runtime";
import { useNotificationStore } from "@/store/notificationStore";
import { saveModelTestLatency } from "@/shared/utils/modelTestLatency";
import { pingModelWithRetry, isDefinitivelyUnavailableModel } from "./modelTestHelpers";
import type { LiveModel, ModelDiagnostic } from "../types";

const MAX_BATCH_MODEL_TESTS = 25;
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
  const notify = useNotificationStore();
  const [modelTestResults, setModelTestResults] = useState<Record<string, "ok" | "error">>({});
  const [modelsTestError, setModelsTestError] = useState<string>("");
  const [testingModelIds, setTestingModelIds] = useState<Set<string>>(() => new Set());
  const [testAllModels, setTestAllModels] = useState<{ running: boolean; results: ModelDiagnostic[] } | null>(null);
  const testAllAbortRef = useRef<AbortController | null>(null);

  const handleTestAllModels = async () => {
    if (testAllAbortRef.current) return;
    const allModels = [...models, ...kiloFreeModels.filter((fm) => !models.some((m) => m.id === fm.id))].filter((m) => { const k = getModelKind(m); return !k || k === "llm"; });
    const disabledSet = new Set(disabledModelIds);
    const modelIds = [...new Set(allModels.map((model) => model.id).filter((id): id is string => typeof id === "string" && id.trim().length > 0).filter((id) => !disabledSet.has(id)))];
    if (modelIds.length === 0) return;
    const sampledModelIds = modelIds.slice(0, MAX_BATCH_MODEL_TESTS);
    if (modelIds.length > sampledModelIds.length) notify.info(`Testing the first ${MAX_BATCH_MODEL_TESTS} of ${modelIds.length} enabled models.`);

    setTestAllModels({ running: true, results: sampledModelIds.map((id) => ({ modelId: id, ok: false, state: "queued", attempts: 0 })) });
    const controller = new AbortController();
    testAllAbortRef.current = controller;
    const maxConcurrent = providerId === "ollama" ? 1 : 3;
    const schedule = providerId === "ollama" ? [25000] : TEST_TIMEOUT_SCHEDULE;
    const results: ModelDiagnostic[] = [];
    let nextIndex = 0;
    const runNext = async () => {
      while (nextIndex < sampledModelIds.length) {
        if (controller.signal.aborted) return;
        const modelId = sampledModelIds[nextIndex++];
        const updateProgress = (d: ModelDiagnostic) => setTestAllModels((c) => c ? { ...c, results: c.results.map((i) => i.modelId === modelId ? d : i) } : c);
        const result = await pingModelWithRetry(providerStorageAlias, modelId, updateProgress, schedule, controller.signal);
        if (result.ok) saveModelTestLatency(providerStorageAlias, modelId, result.latencyMs);
        if (result.state !== "cancelled") setModelTestResults((prev) => ({ ...prev, [modelId]: result.ok ? "ok" : "error" }));
        updateProgress(result);
        results.push(result);
      }
    };
    await Promise.all(Array.from({ length: Math.min(maxConcurrent, sampledModelIds.length) }, runNext));

    const unavailableIds = controller.signal.aborted ? [] : results.filter(isDefinitivelyUnavailableModel).map((r) => r.modelId);
    if (unavailableIds.length > 0) await onDisableModels(unavailableIds);
    setTestAllModels((prev) => prev ? { ...prev, running: false } : prev);
    testAllAbortRef.current = null;
    if (!controller.signal.aborted) {
      const passed = results.filter((r) => r.state === "passed").length;
      const failed = results.length - passed;
      notify.success(`${passed} ${translate("passed") || "passed"}, ${failed} ${translate("failed") || "failed"}`, translate("Model test finished") || "Model test finished");
    }
  };

  const handleCancelTestAllModels = () => {
    const controller = testAllAbortRef.current;
    if (!controller) return;
    controller.abort();
    setTestAllModels((current) => current ? {
      running: false,
      results: current.results.map((r) => r.state === "queued" || r.state === "testing" || r.state === "retrying" ? { ...r, state: "cancelled", error: "Test cancelled" } : r),
    } : current);
  };

  const handleTestModel = async (modelId: string) => {
    if (testingModelIds.has(modelId)) return;
    setTestingModelIds((prev) => new Set(prev).add(modelId));
    try {
      const res = await fetch("/api/models/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}` }) });
      const data = await res.json();
      if (data.ok) saveModelTestLatency(providerStorageAlias, modelId, data.latencyMs);
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
      setModelsTestError(data.ok ? "" : (data.error || translate("Model is not reachable")));
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
      setModelsTestError(translate("Network error") || "Network error");
    } finally { setTestingModelIds((prev) => { const n = new Set(prev); n.delete(modelId); return n; }); }
  };

  return {
    modelTestResults, setModelTestResults, modelsTestError, testingModelIds,
    testAllModels, setTestAllModels, handleTestAllModels, handleCancelTestAllModels, handleTestModel,
  };
}

export type UseModelTestingReturn = ReturnType<typeof useModelTesting>;

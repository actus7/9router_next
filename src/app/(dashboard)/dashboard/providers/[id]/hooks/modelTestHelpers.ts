"use client";

import { translate } from "@/i18n/runtime";
import type { ModelDiagnostic } from "../types";

const TEST_TIMEOUT_SCHEDULE = [15000, 25000, 40000];

export async function pingModelWithRetry(
  providerStorageAlias: string,
  modelId: string,
  onProgress: (diagnostic: ModelDiagnostic) => void,
  timeoutSchedule: readonly number[] = TEST_TIMEOUT_SCHEDULE,
  signal?: AbortSignal,
): Promise<ModelDiagnostic> {
  let lastError = translate("Model is not reachable") || "Model is not reachable";
  let attemptsMade = 0;
  let lastStatus: number | undefined;
  for (let attempt = 0; attempt < timeoutSchedule.length; attempt++) {
    if (signal?.aborted) return { modelId, ok: false, state: "cancelled", error: "Test cancelled", attempts: attemptsMade, status: lastStatus };
    attemptsMade = attempt + 1;
    onProgress({ modelId, ok: false, state: attempt === 0 ? "testing" : "retrying", attempts: attemptsMade });
    try {
      const res = await fetch("/api/models/test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}`, timeoutMs: timeoutSchedule[attempt] }),
        signal,
      });
      const data = await res.json();
      if (data.ok) return { modelId, ok: true, state: "passed", attempts: attemptsMade, latencyMs: data.latencyMs, status: data.status };
      lastError = data.error || lastError;
      lastStatus = data.status;
      if (data.isTimeout) onProgress({ modelId, ok: false, state: "retrying", attempts: attemptsMade, status: lastStatus, error: lastError });
      if (data.status === 429 || Number(data.status) >= 500) { onProgress({ modelId, ok: false, state: "retrying", attempts: attemptsMade, status: lastStatus, error: lastError }); continue; }
      if (!data.isTimeout) break;
    } catch {
      if (signal?.aborted) return { modelId, ok: false, state: "cancelled", error: "Test cancelled", attempts: attemptsMade, status: lastStatus };
      lastError = translate("Network error") || "Network error";
      onProgress({ modelId, ok: false, state: "retrying", attempts: attemptsMade, error: lastError });
    }
  }
  return { modelId, ok: false, state: "failed", error: lastError, attempts: attemptsMade, status: lastStatus };
}

export function isDefinitivelyUnavailableModel(result: ModelDiagnostic): boolean {
  if (result.ok) return false;
  if (result.status === 404) return true;
  return /(?:model .*?(?:not found|does not exist|unsupported|not available)|unknown model)/i.test(result.error || "");
}

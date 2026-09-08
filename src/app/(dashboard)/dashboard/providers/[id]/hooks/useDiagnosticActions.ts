"use client";

import { useState } from "react";

import { saveModelTestLatency } from "@/shared/utils/modelTestLatency";
import { pingModelWithRetry } from "./modelTestHelpers";
import type { CustomModelEntry, ModelDiagnostic } from "../types";

interface UseDiagnosticActionsArgs {
  providerStorageAlias: string;
  setTestAllModels: (
    update: (current: { running: boolean; results: ModelDiagnostic[] } | null) => { running: boolean; results: ModelDiagnostic[] } | null,
  ) => void;
  onDisableModel: (modelId: string) => Promise<void>;
  onDeleteCustomModel: (modelId: string) => Promise<void>;
}

/**
 * Acting on a finished test run: retest, disable, delete.
 *
 * These live next to the run they act on rather than in the modal, because a
 * retest has to write its result back into `testAllModels` — the same list the
 * batch wrote — so the counters and the row update together. A modal that
 * called `handleTestModel` instead would show a toast and leave the row saying
 * "failed" forever.
 *
 * Disable and delete drop the row. That is the honest end state: the model is
 * no longer part of what was tested, and the failure count reflects the work
 * left to do rather than a history of what once failed.
 */
export function useDiagnosticActions({
  providerStorageAlias,
  setTestAllModels,
  onDisableModel,
  onDeleteCustomModel,
}: UseDiagnosticActionsArgs) {
  const [bulkAction, setBulkAction] = useState<"retest" | "disable" | null>(null);

  const patchRow = (modelId: string, next: ModelDiagnostic): void => {
    setTestAllModels((current) =>
      current ? { ...current, results: current.results.map((r) => (r.modelId === modelId ? next : r)) } : current,
    );
  };

  const dropRow = (modelId: string): void => {
    setTestAllModels((current) =>
      current ? { ...current, results: current.results.filter((r) => r.modelId !== modelId) } : current,
    );
  };

  const retestModel = async (modelId: string): Promise<void> => {
    const result = await pingModelWithRetry(providerStorageAlias, modelId, (progress) => patchRow(modelId, progress));
    if (result.ok) saveModelTestLatency(providerStorageAlias, modelId, result.latencyMs);
    patchRow(modelId, result);
  };

  const disableModel = async (modelId: string): Promise<void> => {
    await onDisableModel(modelId);
    dropRow(modelId);
  };

  const deleteCustomModel = async (modelId: string): Promise<void> => {
    await onDeleteCustomModel(modelId);
    dropRow(modelId);
  };

  /**
   * Retests every model in `modelIds`, one at a time.
   *
   * Sequential on purpose: the batch that produced these failures already ran
   * three at a time, and a provider that answered 429 or 500 under that load is
   * the most likely reason a retest is being asked for at all.
   */
  const retestAll = async (modelIds: readonly string[]): Promise<void> => {
    setBulkAction("retest");
    try {
      for (const modelId of modelIds) await retestModel(modelId);
    } finally {
      setBulkAction(null);
    }
  };

  const disableAll = async (modelIds: readonly string[]): Promise<void> => {
    setBulkAction("disable");
    try {
      for (const modelId of modelIds) await disableModel(modelId);
    } finally {
      setBulkAction(null);
    }
  };

  return { bulkAction, retestModel, disableModel, deleteCustomModel, retestAll, disableAll };
}

export type UseDiagnosticActionsReturn = ReturnType<typeof useDiagnosticActions>;

/**
 * The models a delete actually removes for good.
 *
 * `customModels` also holds rows that discovery wrote (`source: "discovered"`),
 * and deleting one of those is a button that undoes itself on the next model
 * refresh. Only the ones the user typed in stay gone, so only those may offer
 * the action. An entry with no `providerAlias` predates the column and belongs
 * to whichever provider is asking.
 */
export function deletableModelIds(
  customModels: readonly CustomModelEntry[],
  providerStorageAlias: string,
): string[] {
  return customModels
    .filter((entry) => entry.source === "manual")
    .filter((entry) => !entry.providerAlias || entry.providerAlias === providerStorageAlias)
    .map((entry) => entry.id);
}

"use client";

import { useMemo } from "react";
import { Loader2, RotateCcw, Trash2, EyeOff } from "lucide-react";

import Modal from "@/shared/components/Modal";
import { Button } from "@/components/ui/button";
import { translate } from "@/i18n/runtime";
import type { ModelDiagnostic, TestAllModelsState } from "../../types";
import DiagnosticRow, { type DiagnosticAction } from "./DiagnosticRow";
import { sortForDisplay } from "./diagnosticStates";
import type { UseDiagnosticActionsReturn } from "../../hooks/useDiagnosticActions";

interface TestDiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  testAllModels: TestAllModelsState | null;
  onCancelTests: () => void;
  actions: UseDiagnosticActionsReturn;
  /** Model ids the user added by hand. Only these can actually be deleted. */
  customModelIds: readonly string[];
}

export default function TestDiagnosticsModal({
  isOpen,
  onClose,
  testAllModels,
  onCancelTests,
  actions,
  customModelIds,
}: TestDiagnosticsModalProps) {
  // Memoised so the fallback empty array is not a new identity every render,
  // which would make the sorted list below recompute for nothing.
  const results = useMemo(() => testAllModels?.results ?? [], [testAllModels]);
  const running = testAllModels?.running ?? false;

  const passed = results.filter((r) => r.state === "passed");
  const failed = results.filter((r) => r.state === "failed");
  const cancelled = results.filter((r) => r.state === "cancelled");
  const autoDisabled = results.filter((r) => r.autoDisabled);
  const settled = passed.length + failed.length + cancelled.length;
  // A model the run already turned off is not something to disable again, and
  // retesting it would not turn it back on. Bulk actions skip those rows.
  const actionable = failed.filter((r) => !r.autoDisabled);

  const customIds = useMemo(() => new Set(customModelIds), [customModelIds]);
  const rows = useMemo(() => sortForDisplay(results), [results]);

  /**
   * A row only offers actions once it has failed and the batch has stopped.
   * Disabling a model mid-run would race the runner that is still testing it.
   */
  function actionsFor(result: ModelDiagnostic): DiagnosticAction[] {
    if (running || result.state !== "failed" || result.autoDisabled) return [];
    const list: DiagnosticAction[] = [
      {
        id: "retest",
        label: translate("Retest") || "Retest",
        Icon: RotateCcw,
        run: () => actions.retestModel(result.modelId),
      },
      {
        id: "disable",
        label: translate("Disable") || "Disable",
        Icon: EyeOff,
        run: () => actions.disableModel(result.modelId),
      },
    ];
    // Discovered models come back on the next refresh, so deleting one would be
    // a button that undoes itself. Only a model the user added stays deleted.
    if (customIds.has(result.modelId)) {
      list.push({
        id: "delete",
        label: translate("Delete") || "Delete",
        Icon: Trash2,
        danger: true,
        run: () => actions.deleteCustomModel(result.modelId),
      });
    }
    return list;
  }

  if (!testAllModels) return null;

  const actionableIds = actionable.map((r) => r.modelId);
  const busy = actions.bulkAction !== null;

  return (
    <Modal
      isOpen={isOpen}
      title={translate("Model Test Diagnostics") || "Model Test Diagnostics"}
      size="full"
      className="max-w-[50rem]"
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {running && (
            <span className="flex items-center gap-1.5 text-text-muted">
              <Loader2 className="size-4 animate-spin" />
              {translate("Testing...")} ({settled}/{results.length})
            </span>
          )}
          <span className="text-success">{translate("Passed") || "Passed"}: {passed.length}</span>
          <span className="text-destructive">{translate("Failed") || "Failed"}: {failed.length}</span>
          {cancelled.length > 0 && (
            <span className="text-warning">{translate("Cancelled") || "Cancelled"}: {cancelled.length}</span>
          )}
          {running && (
            <Button variant="ghost" size="sm" onClick={onCancelTests}>
              {translate("Cancel tests") || "Cancel tests"}
            </Button>
          )}
        </div>

        <p className="text-xs text-text-muted">
          {translate("Retest runs the model again. Disable only hides it from routing — you can re-enable it under Disabled models. Delete removes a model you added by hand.")
            || "Retest runs the model again. Disable only hides it from routing — you can re-enable it under Disabled models. Delete removes a model you added by hand."}
        </p>

        {running && (
          <p className="text-xs text-text-muted">
            {translate("Closing this window keeps the tests running in the background.") || "Closing this window keeps the tests running in the background."}
          </p>
        )}

        {/* The run disables unreachable models on its own. Saying so here is the
            difference between a diagnostic and a silent configuration change. */}
        {autoDisabled.length > 0 && (
          <p className="rounded-lg border border-warning-border/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            {autoDisabled.length}{" "}
            {translate("model(s) were disabled automatically: the provider answered that they do not exist. Re-enable them under Disabled models.")
              || "model(s) were disabled automatically: the provider answered that they do not exist. Re-enable them under Disabled models."}
          </p>
        )}

        {/* A catalogue can be hundreds of models, so nobody clicks per row. */}
        {!running && actionable.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
            <span className="text-xs text-text-muted">
              {actionable.length} {translate("failed and still enabled") || "failed and still enabled"}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void actions.retestAll(actionableIds)}
                className="gap-1.5"
              >
                {actions.bulkAction === "retest"
                  ? <Loader2 className="size-3.5 animate-spin" />
                  : <RotateCcw className="size-3.5" />}
                {translate("Retest these") || "Retest these"} {actionable.length}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void actions.disableAll(actionableIds)}
                className="gap-1.5 text-destructive hover:text-destructive"
              >
                {actions.bulkAction === "disable"
                  ? <Loader2 className="size-3.5 animate-spin" />
                  : <EyeOff className="size-3.5" />}
                {translate("Disable these") || "Disable these"} {actionable.length}
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {rows.map((result) => (
            <DiagnosticRow key={result.modelId} result={result} actions={actionsFor(result)} />
          ))}
        </div>
      </div>
    </Modal>
  );
}

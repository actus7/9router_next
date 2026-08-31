"use client";

import { Button, Modal } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { Ban, Check, Loader2, X as XIcon } from "lucide-react";
import type { ModelDiagnostic } from "../../types";

interface TestDiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  testAllModels: {
    running: boolean;
    results: ModelDiagnostic[];
  } | null;
  onCancelTests: () => void;
}

export default function TestDiagnosticsModal({
  isOpen,
  onClose,
  testAllModels,
  onCancelTests,
}: TestDiagnosticsModalProps) {
  if (!testAllModels) return null;

  const passed = testAllModels.results.filter((r) => r.state === "passed");
  const failed = testAllModels.results.filter((r) => r.state === "failed");
  const cancelled = testAllModels.results.filter((r) => r.state === "cancelled");
  const pending = testAllModels.results.filter((r) => r.state === "queued" || r.state === "testing" || r.state === "retrying");

  return (
    <Modal
      isOpen={isOpen}
      title={translate("Model Test Diagnostics") || "Model Test Diagnostics"}
      size="full"
      className="max-w-[50rem]"
      onClose={() => { if (!testAllModels.running) onClose(); }}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {testAllModels.running && (
            <span className="flex items-center gap-1.5 text-text-muted">
              <Loader2 className="size-4 animate-spin" />
              {translate("Testing...")} ({passed.length + failed.length + cancelled.length}/{testAllModels.results.length})
            </span>
          )}
          <span className="text-green-500">{translate("Passed") || "Passed"}: {passed.length}</span>
          <span className="text-red-500">{translate("Failed") || "Failed"}: {failed.length}</span>
          {cancelled.length > 0 && <span className="text-amber-500">Cancelled: {cancelled.length}</span>}
          {testAllModels.running && <Button variant="ghost" size="sm" onClick={onCancelTests}>Cancel tests</Button>}
        </div>
        <div className="flex flex-col gap-2">
          {pending.map((r, index) => (
            <div key={`pending-${r.modelId}-${index}`} className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2">
              <div className="flex items-center gap-2">
                {r.state === "queued" ? <span className="size-2 shrink-0 rounded-full bg-muted-foreground" /> : <Loader2 className="size-4 shrink-0 animate-spin text-blue-500" />}
                <code className="truncate text-xs font-mono">{r.modelId}</code>
                <span className="ml-auto shrink-0 text-[10px] text-text-muted">
                  {r.state === "queued" ? translate("Queued") || "Queued" : `${r.state === "retrying" ? translate("Retrying") || "Retrying" : translate("Testing...")} ${r.attempts}/3`}
                </span>
              </div>
              {r.error && <p className="mt-1 text-xs text-text-muted break-words">{r.error}</p>}
            </div>
          ))}
          {failed.map((r, index) => (
            <div key={`failed-${r.modelId}-${index}`} className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
              <div className="flex items-center gap-2">
                <XIcon className="size-4 shrink-0 text-red-500" />
                <code className="truncate text-xs font-mono">{r.modelId}</code>
                {r.attempts > 1 && (
                  <span className="ml-auto shrink-0 text-[10px] text-text-muted">
                    {r.attempts}x {translate("attempts") || "attempts"}
                  </span>
                )}
              </div>
              {r.error && <p className="mt-1 text-xs text-text-muted break-words">{r.error}</p>}
            </div>
          ))}
          {cancelled.map((r, index) => (
            <div key={`cancelled-${r.modelId}-${index}`} className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
              <Ban className="size-4 shrink-0 text-amber-500" />
              <code className="truncate text-xs font-mono">{r.modelId}</code>
              <span className="ml-auto text-[10px] text-text-muted">Cancelled</span>
            </div>
          ))}
          {passed.map((r, index) => (
            <div key={`passed-${r.modelId}-${index}`} className="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2">
              <Check className="size-4 shrink-0 text-green-500" />
              <code className="truncate text-xs font-mono">{r.modelId}</code>
              {typeof r.latencyMs === "number" && (
                <span className="ml-auto shrink-0 text-[10px] text-text-muted">{r.latencyMs}ms</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

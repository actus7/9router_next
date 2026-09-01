"use client";

import { Modal } from "@/shared/components";
import { Button } from "@/components/ui/button";
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
          <span className="text-success-foreground">{translate("Passed") || "Passed"}: {passed.length}</span>
          <span className="text-destructive-foreground">{translate("Failed") || "Failed"}: {failed.length}</span>
          {cancelled.length > 0 && <span className="text-warning-foreground">Cancelled: {cancelled.length}</span>}
          {testAllModels.running && <Button variant="ghost" size="sm" onClick={onCancelTests}>Cancel tests</Button>}
        </div>
        <div className="flex flex-col gap-2">
          {pending.map((r, index) => (
            <div key={`pending-${r.modelId}-${index}`} className="rounded-lg border border-info-border bg-info px-3 py-2">
              <div className="flex items-center gap-2">
                {r.state === "queued" ? <span className="size-2 shrink-0 rounded-full bg-muted-foreground" /> : <Loader2 className="size-4 shrink-0 animate-spin text-info-foreground" />}
                <code className="truncate text-xs font-mono">{r.modelId}</code>
                <span className="ml-auto shrink-0 text-[10px] text-text-muted">
                  {r.state === "queued" ? translate("Queued") || "Queued" : `${r.state === "retrying" ? translate("Retrying") || "Retrying" : translate("Testing...")} ${r.attempts}/3`}
                </span>
              </div>
              {r.error && <p className="mt-1 text-xs text-text-muted break-words">{r.error}</p>}
            </div>
          ))}
          {failed.map((r, index) => (
            <div key={`failed-${r.modelId}-${index}`} className="rounded-lg border border-destructive-border bg-destructive px-3 py-2">
              <div className="flex items-center gap-2">
                <XIcon className="size-4 shrink-0 text-destructive-foreground" />
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
            <div key={`cancelled-${r.modelId}-${index}`} className="flex items-center gap-2 rounded-lg border border-warning-border bg-warning px-3 py-2">
              <Ban className="size-4 shrink-0 text-warning-foreground" />
              <code className="truncate text-xs font-mono">{r.modelId}</code>
              <span className="ml-auto text-[10px] text-text-muted">Cancelled</span>
            </div>
          ))}
          {passed.map((r, index) => (
            <div key={`passed-${r.modelId}-${index}`} className="flex items-center gap-2 rounded-lg border border-success-border bg-success px-3 py-2">
              <Check className="size-4 shrink-0 text-success-foreground" />
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

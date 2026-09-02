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
          <span className="text-success">{translate("Passed") || "Passed"}: {passed.length}</span>
          <span className="text-destructive">{translate("Failed") || "Failed"}: {failed.length}</span>
          {cancelled.length > 0 && <span className="text-warning">Cancelled: {cancelled.length}</span>}
          {testAllModels.running && <Button variant="ghost" size="sm" onClick={onCancelTests}>Cancel tests</Button>}
        </div>
        <div className="flex flex-col gap-2">
          {pending.map((r, index) => (
            <div key={`pending-${r.modelId}-${index}`} className="rounded-lg border border-info-border/30 bg-info/10 px-3 py-2 text-info">
              <div className="flex items-center gap-2">
                {r.state === "queued" ? <span className="size-2 shrink-0 rounded-full bg-muted-foreground" /> : <Loader2 className="size-4 shrink-0 animate-spin" />}
                <code className="truncate text-xs font-mono text-foreground">{r.modelId}</code>
                <span className="ml-auto shrink-0 text-[10px] opacity-80">
                  {r.state === "queued" ? translate("Queued") || "Queued" : `${r.state === "retrying" ? translate("Retrying") || "Retrying" : translate("Testing...")} ${r.attempts}/3`}
                </span>
              </div>
              {r.error && <p className="mt-1 text-xs opacity-80 break-words">{r.error}</p>}
            </div>
          ))}
          {failed.map((r, index) => (
            <div key={`failed-${r.modelId}-${index}`} className="rounded-lg border border-destructive-border/30 bg-destructive/10 px-3 py-2 text-destructive">
              <div className="flex items-center gap-2">
                <XIcon className="size-4 shrink-0" />
                <code className="truncate text-xs font-mono text-foreground">{r.modelId}</code>
                {r.attempts > 1 && (
                  <span className="ml-auto shrink-0 text-[10px] opacity-80">
                    {r.attempts}x {translate("attempts") || "attempts"}
                  </span>
                )}
              </div>
              {r.error && <p className="mt-1 text-xs opacity-80 break-words">{r.error}</p>}
            </div>
          ))}
          {cancelled.map((r, index) => (
            <div key={`cancelled-${r.modelId}-${index}`} className="flex items-center gap-2 rounded-lg border border-warning-border/30 bg-warning/10 px-3 py-2 text-warning">
              <Ban className="size-4 shrink-0" />
              <code className="truncate text-xs font-mono text-foreground">{r.modelId}</code>
              <span className="ml-auto text-[10px] opacity-80">Cancelled</span>
            </div>
          ))}
          {passed.map((r, index) => (
            <div key={`passed-${r.modelId}-${index}`} className="flex items-center gap-2 rounded-lg border border-success-border/30 bg-success/10 px-3 py-2 text-success">
              <Check className="size-4 shrink-0" />
              <code className="truncate text-xs font-mono text-foreground">{r.modelId}</code>
              {typeof r.latencyMs === "number" && (
                <span className="ml-auto shrink-0 text-[10px] opacity-80">{r.latencyMs}ms</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

"use client";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface HeadroomSectionProps {
  headroomRunning: boolean;
  headroomStatusLabel: string;
  headroomEnabled: boolean;
  handleHeadroomEnabled: (v: boolean) => void;
  setShowHeadroomInstallModal: (v: boolean) => void;
  headroomStatus: { installed: boolean };
  headroomExtras: { version: string | null; extras: Record<string, boolean>; available: string[] };
  pendingExtras: string[];
  togglePendingExtra: (extra: string) => void;
  codeAware: boolean;
  kompress: boolean;
  restartingProxy: boolean;
  toggleExtraActive: (extra: string, value: boolean) => void;
  handleRemoveExtra: (extra: string) => void;
  removingExtra: string | null;
  handleInstallExtras: () => void;
  extrasActionLoading: boolean;
  extrasActionError: string;
  installLog: string;
}

export default function HeadroomSection({
  headroomRunning, headroomStatusLabel, headroomEnabled, handleHeadroomEnabled,
  setShowHeadroomInstallModal, headroomStatus, headroomExtras, pendingExtras,
  togglePendingExtra, codeAware, kompress, restartingProxy, toggleExtraActive,
  handleRemoveExtra, removingExtra, handleInstallExtras, extrasActionLoading,
  extrasActionError, installLog,
}: HeadroomSectionProps) {
  return (
    <>
      <div className="flex items-center justify-between py-4 gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <p className="font-medium">
              Compress context{" "}
              <a
                href="https://github.com/chopratejas/headroom"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal text-primary underline hover:opacity-80"
              >
                (Headroom)
              </a>
            </p>
            <span
              className={`text-xs px-2 py-0.5 rounded ${headroomRunning ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}
            >
              {headroomStatusLabel}
            </span>
            <Button
              variant="link"
              size="sm"
              onClick={() => setShowHeadroomInstallModal(true)}
              className="h-auto p-0 text-xs"
            >
              {headroomRunning ? "Manage" : "Setup"}
            </Button>
          </div>
          <p className="text-sm text-text-muted mt-1">
            Compress prompts via /v1/compress before routing to the model
          </p>
        </div>
        <Switch
          checked={headroomEnabled}
          onCheckedChange={() => handleHeadroomEnabled(!headroomEnabled)}
        />
      </div>
      {headroomStatus.installed && (
        <div className="mb-3 ml-1 pl-3 pb-4 border-l-2 border-border">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-text-muted">
              Compression extras
              {headroomExtras.version ? ` · v${headroomExtras.version}` : ""}:
            </span>
            {headroomExtras.available.map((extra) => {
              const installed = !!headroomExtras.extras[extra];
              const pending = pendingExtras.includes(extra);
              const extraTitle =
                extra === "code"
                  ? "tree-sitter AST compression for code responses"
                  : "Kompress-v2 HF model for prose/agentic traces (~+1GB)";

              if (installed) {
                const active = extra === "code" ? codeAware : kompress;
                return (
                  <div
                    key={extra}
                    className="flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-success/40 bg-success/5 text-text"
                    title={extraTitle}
                  >
                    <Switch
                      size="sm"
                      checked={active}
                      disabled={restartingProxy}
                      onCheckedChange={() => toggleExtraActive(extra, !active)}
                    />
                    <span className="font-medium">[{extra}]</span>
                    <Button
                      variant="link"
                      size="sm"
                      onClick={() => handleRemoveExtra(extra)}
                      disabled={removingExtra === extra}
                      className="ml-1 h-auto p-0 text-xs text-error"
                      title={`Uninstall [${extra}]`}
                    >
                      {removingExtra === extra ? "Uninstalling…" : "Uninstall"}
                    </Button>
                  </div>
                );
              }

              return (
                <Label
                  key={extra}
                  className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded border cursor-pointer transition-colors ${
                    pending
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-text-muted hover:bg-surface-2"
                  }`}
                  title={extraTitle}
                >
                  <Checkbox
                    checked={pending}
                    onCheckedChange={() => togglePendingExtra(extra)}
                    className="size-3"
                  />
                  <span className="font-medium">[{extra}]</span>
                  <span className="opacity-70">not installed</span>
                </Label>
              );
            })}
            {pendingExtras.length > 0 && (
              <Button
                size="sm"
                onClick={handleInstallExtras}
                disabled={extrasActionLoading}
              >
                {extrasActionLoading
                  ? "Installing…"
                  : `Install [proxy,${pendingExtras.join(",")}]`}
              </Button>
            )}
          </div>
          {extrasActionError && (
            <p className="text-xs text-error mt-1">{extrasActionError}</p>
          )}
          {restartingProxy && (
            <p className="text-xs text-text-muted mt-1">Restarting proxy…</p>
          )}
          {(extrasActionLoading || removingExtra) && installLog && (
            <pre className="mt-2 max-h-32 overflow-auto rounded bg-surface-2 p-2 text-[10px] leading-tight text-text-muted whitespace-pre-wrap">
              {installLog}
            </pre>
          )}
          <p className="text-xs text-text-muted mt-1">
            Installing adds the package; use <code>on</code>/<code>off</code>{" "}
            to activate it (restarts the proxy). Default install is{" "}
            <code>[proxy]</code> only (SmartCrusher for JSON). Adding{" "}
            <code>[code]</code> enables AST compression
            (Python/JS/TS/Go/Rust/Java/C/C++/Perl). Adding <code>[ml]</code>{" "}
            enables the Kompress-v2 HF model for prose/agentic traces but
            adds ~1 GB (torch + huggingface-hub).
          </p>
        </div>
      )}
    </>
  );
}

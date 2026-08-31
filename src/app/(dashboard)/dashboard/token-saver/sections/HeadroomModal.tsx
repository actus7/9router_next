"use client";

import { Button, Input, Modal } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

interface HeadroomModalProps {
  showHeadroomInstallModal: boolean;
  setShowHeadroomInstallModal: (v: boolean) => void;
  headroomRunning: boolean;
  headroomStatusLabel: string;
  headroomUrl: string;
  setHeadroomUrl: (v: string) => void;
  handleHeadroomUrlBlur: () => void;
  headroomManaged: boolean;
  headroomCanStart: boolean;
  headroomLocalUrl: boolean;
  headroomStatus: { python: string | null };
  headroomActionLoading: boolean;
  headroomActionError: string;
  handleHeadroomStart: () => void;
  handleHeadroomStop: () => void;
  refreshHeadroomStatus: () => void;
}

export default function HeadroomModal({
  showHeadroomInstallModal, setShowHeadroomInstallModal,
  headroomRunning, headroomStatusLabel, headroomUrl, setHeadroomUrl,
  handleHeadroomUrlBlur, headroomManaged, headroomCanStart, headroomLocalUrl,
  headroomStatus, headroomActionLoading, headroomActionError,
  handleHeadroomStart, handleHeadroomStop, refreshHeadroomStatus,
}: HeadroomModalProps) {
  const { copied, copy } = useCopyToClipboard();

  return (
    <Modal
      isOpen={showHeadroomInstallModal}
      title={headroomRunning ? "Headroom" : "Setup Headroom"}
      onClose={() => setShowHeadroomInstallModal(false)}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between text-sm">
          <span>Status</span>
          <span
            className={headroomRunning ? "text-success" : "text-warning"}
          >
            {headroomStatusLabel}
          </span>
        </div>
        {headroomRunning && (
          <a
            href="/api/headroom/proxy/dashboard"
            target="_blank"
            rel="noreferrer"
            className="w-full rounded border border-border px-4 py-2 text-center text-sm hover:bg-surface-2"
          >
            Open Headroom Dashboard
          </a>
        )}
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Proxy URL</p>
          <Input
            value={headroomUrl}
            onChange={(e) => setHeadroomUrl(e.target.value)}
            onBlur={handleHeadroomUrlBlur}
            placeholder="http://localhost:8787"
            className="font-mono text-sm"
          />
          <p className="text-xs text-text-muted">
            Use a local proxy for Start/Stop, or an external Docker sidecar
            like http://headroom:8787.
          </p>
        </div>
        {headroomManaged ? (
          <Button
            onClick={handleHeadroomStop}
            variant="ghost"
            fullWidth
            disabled={headroomActionLoading}
          >
            {headroomActionLoading ? "Stopping…" : "Stop Headroom"}
          </Button>
        ) : headroomRunning ? (
          <p className="text-sm text-success">
            Headroom proxy is reachable. You can enable the token saver.
          </p>
        ) : headroomCanStart ? (
          <Button
            onClick={handleHeadroomStart}
            fullWidth
            disabled={headroomActionLoading}
          >
            {headroomActionLoading ? "Starting…" : "Start Headroom"}
          </Button>
        ) : !headroomLocalUrl ? (
          <p className="text-sm text-warning">
            Start Headroom separately at the configured URL, then recheck.
          </p>
        ) : !headroomStatus.python ? (
          <p className="text-sm text-warning">
            Python ≥ 3.10 required for local managed mode. Install Python
            first, or use an external proxy URL.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Install then click Start:</p>
            <div className="flex items-center gap-2">
              <pre className="flex-1 rounded bg-black/5 dark:bg-white/5 p-2 text-xs font-mono overflow-x-auto">
                {`pip install "headroom-ai[proxy]"`}
              </pre>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  copy(`pip install "headroom-ai[proxy]"`)
                }
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        )}
        {headroomActionError && (
          <p className="text-sm text-warning">{headroomActionError}</p>
        )}
        <div className="flex gap-2">
          <Button
            onClick={() => refreshHeadroomStatus()}
            variant="ghost"
            fullWidth
          >
            Recheck
          </Button>
          <Button
            onClick={() => setShowHeadroomInstallModal(false)}
            fullWidth
          >
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}

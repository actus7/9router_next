"use client";

import { Modal, ConfirmModal } from "@/shared/components";
import { FormInput as Input } from "@/components/ui/form-input";
import { Button } from "@/components/ui/button";
import StatusAlert from "../components/StatusAlert";
import { Check, CheckCircle2, CloudUpload, Copy, Loader2 } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { TUNNEL_BENEFITS } from "../endpointConstants";
import type { StatusInfo, ConfirmState } from "../types";

interface EndpointModalsProps {
  // Add Key Modal
  showAddModal: boolean;
  setShowAddModal: (v: boolean) => void;
  newKeyName: string;
  setNewKeyName: (v: string) => void;
  handleCreateKey: () => void;
  // Created Key Modal
  createdKey: string | null;
  setCreatedKey: (v: string | null) => void;
  copied: string | null;
  copy: (text: string, id: string) => void;
  // Enable Tunnel Modal
  showEnableTunnelModal: boolean;
  setShowEnableTunnelModal: (v: boolean) => void;
  handleEnableTunnel: () => void;
  // Disable Tunnel Modal
  showDisableTunnelModal: boolean;
  setShowDisableTunnelModal: (v: boolean) => void;
  handleDisableTunnel: () => void;
  tunnelLoading: boolean;
  // Tailscale Modal
  showTsModal: boolean;
  setShowTsModal: (v: boolean) => void;
  tsInstalled: boolean | null;
  tsInstalling: boolean;
  tsInstallLog: string[];
  tsSudoPassword: string;
  setTsSudoPassword: (v: string) => void;
  tsStatus: StatusInfo | null;
  handleInstallTailscale: () => void;
  handleConnectTailscale: () => void;
  tsLogRef: React.RefObject<HTMLDivElement | null>;
  // Disable Tailscale Modal
  showDisableTsModal: boolean;
  setShowDisableTsModal: (v: boolean) => void;
  handleDisableTailscale: () => void;
  tsLoading: boolean;
  // Confirm Modal
  confirmState: ConfirmState | null;
  setConfirmState: (v: ConfirmState | null) => void;
}

export default function EndpointModals({
  showAddModal, setShowAddModal, newKeyName, setNewKeyName, handleCreateKey,
  createdKey, setCreatedKey, copied, copy,
  showEnableTunnelModal, setShowEnableTunnelModal, handleEnableTunnel,
  showDisableTunnelModal, setShowDisableTunnelModal, handleDisableTunnel, tunnelLoading,
  showTsModal, setShowTsModal, tsInstalled, tsInstalling, tsInstallLog, tsSudoPassword: _tsSudoPassword, setTsSudoPassword, tsStatus, handleInstallTailscale, handleConnectTailscale, tsLogRef,
  showDisableTsModal, setShowDisableTsModal, handleDisableTailscale, tsLoading,
  confirmState, setConfirmState,
}: EndpointModalsProps) {
  return (
    <>
      {/* Add Key Modal */}
      <Modal
        isOpen={showAddModal}
        title={translate("Create API Key") || "Create API Key"}
        onClose={() => {
          setShowAddModal(false);
          setNewKeyName("");
        }}
      >
        <div className="flex flex-col gap-4">
          <Input
            label={translate("Key Name") || "Key Name"}
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder={translate("Production Key") || "Production Key"}
          />
          <div className="flex gap-2">
            <Button onClick={handleCreateKey} fullWidth disabled={!newKeyName.trim()}>
              {translate("Create") || "Create"}
            </Button>
            <Button
              onClick={() => {
                setShowAddModal(false);
                setNewKeyName("");
              }}
              variant="ghost"
              fullWidth
            >
              {translate("Cancel") || "Cancel"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Created Key Modal */}
      <Modal
        isOpen={!!createdKey}
        title={translate("API Key Created") || "API Key Created"}
        onClose={() => setCreatedKey(null)}
      >
        <div className="flex flex-col gap-4">
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
              <p className="text-sm text-yellow-800 dark:text-yellow-200 mb-2 font-medium">
                {translate("Save this key now!") || "Save this key now!"}
              </p>
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                {translate("This is the only time you will see this key. Store it securely.") || "This is the only time you will see this key. Store it securely."}
              </p>
          </div>
          <div className="flex gap-2">
            <Input
              value={createdKey || ""}
              readOnly
              className="flex-1 font-mono text-sm"
            />
            <Button
              variant="secondary"
              icon={copied === "created_key" ? <Check className="size-4" /> : <Copy className="size-4" />}
              onClick={() => copy(createdKey ?? "", "created_key")}
            >
              {copied === "created_key" ? (translate("Copied!") || "Copied!") : (translate("Copy") || "Copy")}
            </Button>
          </div>
            <Button onClick={() => setCreatedKey(null)} fullWidth>
              {translate("Done") || "Done"}
          </Button>
        </div>
      </Modal>

      {/* Enable Tunnel Modal */}
      <Modal
        isOpen={showEnableTunnelModal}
        title={translate("Enable Tunnel") || "Enable Tunnel"}
        onClose={() => setShowEnableTunnelModal(false)}
      >
        <div className="flex flex-col gap-4">
          <div className="bg-surface-2 border border-border-subtle rounded-lg p-4">
            <div className="flex items-start gap-3">
              <CloudUpload className="size-4" />
              <div>
                <p className="text-sm text-text-main font-medium mb-1">
                  Cloudflare Tunnel
                </p>
                <p className="text-sm text-text-muted">
                  {translate("Expose your local ModelHub to the internet. No port forwarding, no static IP required. Share the endpoint URL with your team or use in Cursor, Cline and other AI tools from anywhere.") || "Expose your local ModelHub to the internet. No port forwarding, no static IP required. Share the endpoint URL with your team or use in Cursor, Cline and other AI tools from anywhere."}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {TUNNEL_BENEFITS.map((benefit) => (
              <div key={benefit.title} className="flex flex-col items-center text-center p-3 rounded-lg bg-sidebar/50">
                <span className="text-xl text-primary mb-1">{benefit.icon}</span>
                <p className="text-xs font-semibold">{benefit.title}</p>
                <p className="text-xs text-text-muted">{benefit.desc}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-text-muted">
            {translate("Requires outbound port 7844 (TCP/UDP). Connection may take 10-30s.") || "Requires outbound port 7844 (TCP/UDP). Connection may take 10-30s."}
          </p>

          <div className="flex gap-2">
            <Button onClick={handleEnableTunnel} fullWidth>
              {translate("Start Tunnel") || "Start Tunnel"}
            </Button>
            <Button onClick={() => setShowEnableTunnelModal(false)} variant="ghost" fullWidth>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Disable Cloudflare Tunnel Modal */}
      <Modal
        isOpen={showDisableTunnelModal}
        title={translate("Disable Tunnel") || "Disable Tunnel"}
        onClose={() => !tunnelLoading && setShowDisableTunnelModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">{translate("The Cloudflare tunnel will be disconnected. Remote access via tunnel URL will stop working.") || "The Cloudflare tunnel will be disconnected. Remote access via tunnel URL will stop working."}</p>
          <div className="flex gap-2">
            <Button onClick={handleDisableTunnel} fullWidth disabled={tunnelLoading} variant="danger">
              {tunnelLoading ? (translate("Disabling...") || "Disabling...") : (translate("Disable") || "Disable")}
            </Button>
            <Button onClick={() => setShowDisableTunnelModal(false)} variant="ghost" fullWidth disabled={tunnelLoading}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Tailscale Modal */}
      <Modal
        isOpen={showTsModal}
        title="Tailscale Funnel"
        onClose={() => { if (!tsInstalling) { setShowTsModal(false); setTsSudoPassword(""); } }}
      >
        <div className="flex flex-col gap-4">
          {/* Checking state */}
          {tsInstalled === null && (
            <p className="text-sm text-text-muted flex items-center gap-2">
              <Loader2 className="size-4" />
              {translate("Checking...") || "Checking..."}
            </p>
          )}

          {/* Not installed */}
          {tsInstalled === false && !tsInstalling && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text-muted">{translate("Tailscale is not installed. Install it to enable Funnel.") || "Tailscale is not installed. Install it to enable Funnel."}</p>
              <div className="flex gap-2">
                <Button onClick={handleInstallTailscale} fullWidth>
                  {translate("Install Tailscale") || "Install Tailscale"}
                </Button>
                <Button onClick={() => setShowTsModal(false)} variant="ghost" fullWidth>Cancel</Button>
              </div>
            </div>
          )}

          {/* Installing with progress log */}
          {tsInstalling && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <Loader2 className="size-4" />
                {translate("Installing Tailscale...") || "Installing Tailscale..."}
              </div>
              {tsInstallLog.length > 0 && (
                <div ref={tsLogRef} className="bg-black/5 dark:bg-white/5 rounded p-2 max-h-40 overflow-y-auto font-mono text-xs text-text-muted">
                  {tsInstallLog.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Installed: show Connect button */}
          {tsInstalled === true && !tsInstalling && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <CheckCircle2 className="size-4" />
                {translate("Tailscale installed") || "Tailscale installed"}
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => handleConnectTailscale()}
                  fullWidth
                >
                  {translate("Connect") || "Connect"}
                </Button>
                <Button onClick={() => setShowTsModal(false)} variant="ghost" fullWidth>Cancel</Button>
              </div>
            </div>
          )}

          {tsStatus && <StatusAlert status={tsStatus} />}
        </div>
      </Modal>

      {/* Disable Tailscale Modal */}
      <Modal
        isOpen={showDisableTsModal}
        title={translate("Disable Tailscale") || "Disable Tailscale"}
        onClose={() => !tsLoading && setShowDisableTsModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">{translate("Tailscale Funnel will be stopped. Remote access via Tailscale URL will stop working.") || "Tailscale Funnel will be stopped. Remote access via Tailscale URL will stop working."}</p>
          <div className="flex gap-2">
            <Button onClick={handleDisableTailscale} fullWidth disabled={tsLoading} variant="danger">
              {tsLoading ? (translate("Disabling...") || "Disabling...") : (translate("Disable") || "Disable")}
            </Button>
            <Button onClick={() => setShowDisableTsModal(false)} variant="ghost" fullWidth disabled={tsLoading}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm ?? (() => {})}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        variant="danger"
      />
    </>
  );
}

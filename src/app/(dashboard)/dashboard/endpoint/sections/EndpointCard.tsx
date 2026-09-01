"use client";

import { Card, Button, Input } from "@/shared/components";
import { Switch } from "@/components/ui/switch";
import EndpointRow from "../components/EndpointRow";
import SecurityWarning from "../components/SecurityWarning";
import Tooltip from "../components/Tooltip";
import { AlertCircle, Check, CloudUpload, Copy, ExternalLink, Loader2, Lock, Power, Webhook } from "lucide-react";
import { translate } from "@/i18n/runtime";
import type { StatusInfo } from "../types";

interface EndpointCardProps {
  currentEndpoint: string;
  copied: string | null;
  copy: (text: string, id: string) => void;
  // Tunnel
  tunnelEnabled: boolean;
  tunnelLoading: boolean;
  tunnelReachable: boolean;
  tunnelUrl: string;
  tunnelPublicUrl: string;
  tunnelProgress: string;
  tunnelChecking: boolean;
  tunnelStatus: StatusInfo | null;
  tunnelEverReachable: boolean;
  setShowEnableTunnelModal: (v: boolean) => void;
  setShowDisableTunnelModal: (v: boolean) => void;
  setTunnelLoading: (v: boolean) => void;
  setTunnelProgress: (v: string) => void;
  setTunnelStatus: (v: StatusInfo | null) => void;
  setTunnelChecking: (v: boolean) => void;
  setTunnelEverReachable: (v: boolean) => void;
  // Tailscale
  tsEnabled: boolean;
  tsLoading: boolean;
  tsConnecting: boolean;
  tsReachable: boolean;
  tsUrl: string;
  tsProgress: string;
  tsStatus: StatusInfo | null;
  tsAuthUrl: string;
  tsAuthLabel: string;
  tsEverReachable: boolean;
  setShowDisableTsModal: (v: boolean) => void;
  handleOpenTsModal: () => void;
  setTsLoading: (v: boolean) => void;
  setTsConnecting: (v: boolean) => void;
  setTsProgress: (v: string) => void;
  setTsStatus: (v: StatusInfo | null) => void;
  clearUserAuth: () => void;
  // Settings
  requireApiKey: boolean;
  requireLogin: boolean;
  hasPassword: boolean;
  tunnelDashboardAccess: boolean;
  handleTunnelDashboardAccess: (v: boolean) => void;
  // Security
  isLoginUnsafe: boolean;
  unsafeReason: string;
}

export default function EndpointCard({
  currentEndpoint, copied, copy,
  tunnelEnabled, tunnelLoading, tunnelReachable, tunnelUrl, tunnelPublicUrl,
  tunnelProgress, tunnelChecking, tunnelStatus, tunnelEverReachable,
  setShowEnableTunnelModal,   setShowDisableTunnelModal, setTunnelLoading, setTunnelProgress, setTunnelStatus, setTunnelChecking, setTunnelEverReachable: _setTunnelEverReachable,
  tsEnabled, tsLoading, tsConnecting, tsReachable, tsUrl, tsProgress, tsStatus, setTsStatus,
  tsAuthUrl, tsAuthLabel, tsEverReachable,
  setShowDisableTsModal, handleOpenTsModal, setTsLoading, setTsConnecting, setTsProgress, clearUserAuth,
  requireApiKey, requireLogin, hasPassword, tunnelDashboardAccess, handleTunnelDashboardAccess,
  isLoginUnsafe, unsafeReason,
}: EndpointCardProps) {
  return (
    <Card>
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <Webhook className="size-4" />
        API Endpoint
      </h2>

      {/* Endpoint rows */}
      <div className="flex flex-col gap-2">
        {/* Local */}
        <EndpointRow
          label="Local"
          url={currentEndpoint}
          copyId="local_url"
          copied={copied}
          onCopy={copy}
        />
        {/* Cloudflare Tunnel */}
        <div className="flex items-center gap-2">
          <span className={`text-xs font-mono px-1.5 py-0.5 rounded shrink-0 min-w-[88px] text-center ${
            tunnelEnabled ? "bg-primary/10 text-primary" : "bg-surface-2 text-text-muted"
          }`}>Tunnel</span>
          {tunnelEnabled && !tunnelLoading && tunnelReachable ? (
            <>
              <Input value={`${tunnelPublicUrl || tunnelUrl}/v1`} readOnly className="flex-1 font-mono text-sm" />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => copy(`${tunnelPublicUrl || tunnelUrl}/v1`, "tunnel_url")}
              >
                {copied === "tunnel_url" ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
              <Button
                variant="destructive"
                size="icon"
                onClick={() => setShowDisableTunnelModal(true)}
                title={translate("Disable Tunnel") || "Disable Tunnel"}
              >
                <Power className="size-5" />
              </Button>
            </>
          ) : tunnelEnabled && !tunnelLoading && !tunnelReachable ? (
            <>
              <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-amber-300 dark:border-amber-800 bg-amber-500/5 text-sm text-amber-600 dark:text-amber-400">
                <Loader2 className="size-4" />
                {tunnelEverReachable ? (translate("Tunnel reconnecting...") || "Tunnel reconnecting...") : (translate("Tunnel checking...") || "Tunnel checking...")}
              </div>
              <Button
                variant="destructive"
                size="icon"
                onClick={() => setShowDisableTunnelModal(true)}
                title={translate("Disable Tunnel") || "Disable Tunnel"}
              >
                <Power className="size-5" />
              </Button>
            </>
          ) : tunnelLoading ? (
            <>
              <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-input text-sm text-text-muted">
                <Loader2 className="size-4" />
                {tunnelProgress || (translate("Creating tunnel...") || "Creating tunnel...")}
              </div>
              <Button
                variant="destructive"
                size="icon"
                onClick={() => { setTunnelLoading(false); setTunnelProgress(""); }}
                title="Stop"
              >
                <Power className="size-5" />
              </Button>
            </>
          ) : tunnelStatus?.type === "error" ? (
            <>
              <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-red-300 dark:border-red-800 bg-red-500/5 text-sm text-red-600 dark:text-red-400">
                <AlertCircle className="size-4" />
                {tunnelStatus.message}
              </div>
              <Button size="sm" icon={<CloudUpload className="size-4" />} onClick={() => setShowEnableTunnelModal(true)}>Enable</Button>
            </>
          ) : tunnelChecking ? (
            <>
              <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-input text-sm text-text-muted">
                <Loader2 className="size-4" />
                {translate("Checking...") || "Checking..."}
              </div>
              <Button
                variant="destructive"
                size="icon"
                onClick={() => setTunnelChecking(false)}
                title="Stop"
              >
                <Power className="size-5" />
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              icon={<CloudUpload className="size-4" />}
              onClick={() => {
                if (isLoginUnsafe) {
                  setTunnelStatus({ type: "error", message: `${translate("Security required:") || "Security required:"} ${unsafeReason}` });
                  return;
                }
                if (!requireApiKey) {
                  setTunnelStatus({ type: "error", message: `${translate("Security required:") || "Security required:"} ${translate("Enable \"Require API key\" before enabling the tunnel.") || "Enable \"Require API key\" before enabling the tunnel."}` });
                  return;
                }
                setShowEnableTunnelModal(true);
              }}
            >
              Enable
            </Button>
          )}
        </div>
        {/* Tailscale */}
        <div className="flex items-center gap-2">
          <span className={`text-xs font-mono px-1.5 py-0.5 rounded shrink-0 min-w-[88px] text-center ${
            tsEnabled ? "bg-primary/10 text-primary" : "bg-surface-2 text-text-muted"
          }`}>Tailscale</span>
          {tsEnabled && !tsLoading && tsReachable ? (
            <>
              <Input value={`${tsUrl}/v1`} readOnly className="flex-1 font-mono text-sm" />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => copy(`${tsUrl}/v1`, "ts_url")}
              >
                {copied === "ts_url" ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
              <Button
                variant="destructive"
                size="icon"
                onClick={() => setShowDisableTsModal(true)}
                title={translate("Disable Tailscale") || "Disable Tailscale"}
              >
                <Power className="size-5" />
              </Button>
            </>
          ) : tsEnabled && !tsLoading && !tsReachable ? (
            <>
              <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-amber-300 dark:border-amber-800 bg-amber-500/5 text-sm text-amber-600 dark:text-amber-400">
                <Loader2 className="size-4" />
                {tsEverReachable ? (translate("Tailscale reconnecting...") || "Tailscale reconnecting...") : (translate("Tailscale checking...") || "Tailscale checking...")}
              </div>
              <Button
                variant="destructive"
                size="icon"
                onClick={() => setShowDisableTsModal(true)}
                title={translate("Disable Tailscale") || "Disable Tailscale"}
              >
                <Power className="size-5" />
              </Button>
            </>
          ) : (tsLoading || tsConnecting) ? (
            <>
              <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-input text-sm text-text-muted">
                <Loader2 className="size-4" />
                {tsProgress || (translate("Connecting...") || "Connecting...")}
              </div>
              {tsAuthUrl && (
                <Button
                  size="sm"
                  icon={<ExternalLink className="size-4" />}
                  onClick={() => window.open(tsAuthUrl, "tailscale_auth", "width=600,height=700,noopener,noreferrer")}
                >
                  {tsAuthLabel || "Open"}
                </Button>
              )}
              <Button
                variant="destructive"
                size="icon"
                onClick={() => { setTsLoading(false); setTsConnecting(false); setTsProgress(""); clearUserAuth(); }}
                title="Stop"
              >
                <Power className="size-5" />
              </Button>
            </>
          ) : tsStatus?.type === "error" ? (
            <>
              <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded border border-red-300 dark:border-red-800 bg-red-500/5 text-sm text-red-600 dark:text-red-400">
                <AlertCircle className="size-4" />
                {tsStatus.message}
              </div>
              <Button size="sm" icon={<Lock className="size-4" />} onClick={handleOpenTsModal}>Enable</Button>
            </>
          ) : (
            <Button
              size="sm"
              icon={<Lock className="size-4" />}
              onClick={() => {
                if (isLoginUnsafe) {
                  setTsStatus({ type: "error", message: `Security required: ${unsafeReason}` });
                  return;
                }
                handleOpenTsModal();
              }}
              className="bg-linear-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white!"
            >
              Enable
            </Button>
          )}
        </div>
      </div>

      {/* Pre-enable security gate banner */}
      {isLoginUnsafe && !tunnelEnabled && !tsEnabled && (
        <div className="mt-4">
          <SecurityWarning
            message={unsafeReason}
            action={{ label: translate("Open settings") || "Open settings", href: "/dashboard/profile" }}
          />
        </div>
      )}

      {/* Security warnings when tunnel or tailscale is active */}
      {(tunnelEnabled || tsEnabled) && (
        <div className="mt-4 flex flex-col gap-2">
          {!requireApiKey && (
            <SecurityWarning
              message={translate("Require API key is disabled — your endpoint is publicly accessible without authentication.") || "Require API key is disabled — your endpoint is publicly accessible without authentication."}
              action={{ label: translate("Enable") || "Enable", href: "#require-api-key" }}
            />
          )}
          {(!requireLogin || !hasPassword) && (
            <SecurityWarning
              message={
                !requireLogin
                  ? (translate("Require login is disabled — anyone can access your dashboard via tunnel.") || "Require login is disabled — anyone can access your dashboard via tunnel.")
                  : (translate("Dashboard uses the default password — change in Profile settings.") || "Dashboard uses the default password — change in Profile settings.")
              }
              action={{
                label: !requireLogin ? (translate("Enable") || "Enable") : (translate("Change password") || "Change password"),
                href: "/dashboard/profile",
              }}
            />
          )}
        </div>
      )}

      {/* Tunnel dashboard access option */}
      {(tunnelEnabled || tsEnabled) && (
        <div className="mt-4 pt-4 border-t border-border flex items-center gap-3">
          <Switch
            checked={tunnelDashboardAccess}
            onCheckedChange={() => handleTunnelDashboardAccess(!tunnelDashboardAccess)}
          />
          <div className="flex items-center gap-1.5">
            <p className="font-medium text-sm">{translate("Allow dashboard access via tunnel") || "Allow dashboard access via tunnel"}</p>
            <Tooltip text={translate("When enabled, the dashboard can be accessed through your tunnel or Tailscale URL (login still required). When disabled, dashboard access via tunnel/Tailscale is completely blocked.") || "When enabled, the dashboard can be accessed through your tunnel or Tailscale URL (login still required). When disabled, dashboard access via tunnel/Tailscale is completely blocked."} />
          </div>
        </div>
      )}
    </Card>
  );
}

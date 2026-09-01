"use client";

import { useEffect } from "react";
import { CardSkeleton } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { clientPingUrl, clientPingAny } from "./endpointPing";
import { STATUS_POLL_FAST_MS, CLIENT_PING_FAST_MS, REACHABLE_MISS_THRESHOLD } from "./endpointConstants";
import { translate } from "@/i18n/runtime";
import { useApiKeys } from "./hooks/useApiKeys";
import { useEndpointSettings } from "./hooks/useEndpointSettings";
import { useTunnel } from "./hooks/useTunnel";
import { useTailscale } from "./hooks/useTailscale";
import EndpointCard from "./sections/EndpointCard";
import ApiKeysCard from "./sections/ApiKeysCard";
import EndpointModals from "./sections/EndpointModals";
import type { APIPageClientProps } from "./types";

export default function APIPageClient({ machineId: _machineId }: APIPageClientProps) {
  const apiKeys = useApiKeys();
  const settings = useEndpointSettings();
  const tunnel = useTunnel();
  const tailscale = useTailscale();
  const { copied, copy } = useCopyToClipboard();

  // Security gate: block remote exposure while dashboard uses default password or login is off.
  const isLoginUnsafe = !settings.requireLogin || !settings.hasPassword;
  const unsafeReason = !settings.requireLogin
    ? (translate("Enable \"Require login\" and set a custom password before enabling the tunnel.") || "Enable \"Require login\" and set a custom password before enabling the tunnel.")
    : (translate("Change the dashboard default password before enabling the tunnel.") || "Change the dashboard default password before enabling the tunnel.");

  useEffect(() => {
    apiKeys.fetchData();
    settings.loadSettings();
    tunnel.loadTunnelStatus();
  }, [apiKeys, settings, tunnel]);

  // Status poll: only while degraded (not yet reachable). Stop once healthy to avoid spam.
  // Visibility re-check: refresh once when tab becomes visible.
  useEffect(() => {
    const anyEnabled = tunnel.tunnelEnabled || tailscale.tsEnabled;
    if (!anyEnabled) return;
    const tunnelHealthy = !tunnel.tunnelEnabled || tunnel.tunnelReachable;
    const tsHealthy = !tailscale.tsEnabled || tailscale.tsReachable;
    const allHealthy = tunnelHealthy && tsHealthy;
    const syncTunnelStatus = async () => {
      try {
        const statusRes = await fetch("/api/tunnel/status", { cache: "no-store" });
        if (!statusRes.ok) return;
        const data = await statusRes.json();
        tunnel.syncFromStatus(data);
        tailscale.syncFromStatus(data);
      } catch { /* ignore poll errors */ }
    };
    const onVisible = () => { if (!document.hidden) syncTunnelStatus(); };
    document.addEventListener("visibilitychange", onVisible);
    if (allHealthy) return () => document.removeEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => { if (!document.hidden) syncTunnelStatus(); }, STATUS_POLL_FAST_MS);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tunnel.tunnelEnabled, tailscale.tsEnabled, tunnel.tunnelReachable, tailscale.tsReachable, tunnel, tailscale]);

  // Browser-side periodic ping: probes tunnel/tailscale URLs directly so UI stays
  // "reachable" even when backend DNS (1.1.1.1) hiccups on *.ts.net or *.trycloudflare.com.
  // Adaptive: slow when healthy, fast when degraded; pause when tab hidden.
  useEffect(() => {
    const probeBoth = async () => {
      if (document.hidden) return;
      if (tunnel.tunnelEnabled && (tunnel.tunnelUrl || tunnel.tunnelPublicUrl)) {
        const ok = await clientPingAny(tunnel.tunnelPublicUrl, tunnel.tunnelUrl);
        tunnel.tunnelClientReachableRef.current = ok;
        if (ok) { tunnel.tunnelMissRef.current = 0; tunnel.setTunnelReachable(true); if (!tunnel.tunnelEverReachableRef.current) { tunnel.tunnelEverReachableRef.current = true; tunnel.setTunnelEverReachable(true); } }
        else { tunnel.tunnelMissRef.current += 1; if (tunnel.tunnelMissRef.current >= REACHABLE_MISS_THRESHOLD) tunnel.setTunnelReachable(false); }
      } else {
        tunnel.tunnelClientReachableRef.current = false;
      }
      if (tailscale.tsEnabled && tailscale.tsUrl) {
        const ok = await clientPingUrl(tailscale.tsUrl);
        tailscale.tsClientReachableRef.current = ok;
        if (ok) { tailscale.tsMissRef.current = 0; tailscale.setTsReachable(true); if (!tailscale.tsEverReachableRef.current) { tailscale.tsEverReachableRef.current = true; tailscale.setTsEverReachable(true); } }
        else { tailscale.tsMissRef.current += 1; if (tailscale.tsMissRef.current >= REACHABLE_MISS_THRESHOLD) tailscale.setTsReachable(false); }
      } else {
        tailscale.tsClientReachableRef.current = false;
      }
    };
    const anyEnabled = (tunnel.tunnelEnabled && (tunnel.tunnelUrl || tunnel.tunnelPublicUrl)) || (tailscale.tsEnabled && tailscale.tsUrl);
    if (!anyEnabled) return;
    probeBoth();
    const tunnelHealthy = !tunnel.tunnelEnabled || tunnel.tunnelReachable;
    const tsHealthy = !tailscale.tsEnabled || tailscale.tsReachable;
    if (tunnelHealthy && tsHealthy) return;
    const id = setInterval(probeBoth, CLIENT_PING_FAST_MS);
    return () => clearInterval(id);
  }, [tunnel.tunnelEnabled, tunnel.tunnelUrl, tunnel.tunnelPublicUrl, tailscale.tsEnabled, tailscale.tsUrl, tunnel.tunnelReachable, tailscale.tsReachable, tunnel, tailscale]);

  if (apiKeys.loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const currentEndpoint = settings.baseUrl;

  return (
    <div className="flex flex-col gap-8">
      <EndpointCard
        currentEndpoint={currentEndpoint}
        copied={copied}
        copy={copy}
        tunnelEnabled={tunnel.tunnelEnabled}
        tunnelLoading={tunnel.tunnelLoading}
        tunnelReachable={tunnel.tunnelReachable}
        tunnelUrl={tunnel.tunnelUrl}
        tunnelPublicUrl={tunnel.tunnelPublicUrl}
        tunnelProgress={tunnel.tunnelProgress}
        tunnelChecking={tunnel.tunnelChecking}
        tunnelStatus={tunnel.tunnelStatus}
        tunnelEverReachable={tunnel.tunnelEverReachable}
        setShowEnableTunnelModal={tunnel.setShowEnableTunnelModal}
        setShowDisableTunnelModal={tunnel.setShowDisableTunnelModal}
        setTunnelLoading={tunnel.setTunnelLoading}
        setTunnelProgress={tunnel.setTunnelProgress}
        setTunnelStatus={tunnel.setTunnelStatus}
        setTunnelChecking={tunnel.setTunnelChecking}
        setTunnelEverReachable={tunnel.setTunnelEverReachable}
        tsEnabled={tailscale.tsEnabled}
        tsLoading={tailscale.tsLoading}
        tsConnecting={tailscale.tsConnecting}
        tsReachable={tailscale.tsReachable}
        tsUrl={tailscale.tsUrl}
        tsProgress={tailscale.tsProgress}
        tsStatus={tailscale.tsStatus}
        tsAuthUrl={tailscale.tsAuthUrl}
        tsAuthLabel={tailscale.tsAuthLabel}
        tsEverReachable={tailscale.tsEverReachable}
        setShowDisableTsModal={tailscale.setShowDisableTsModal}
        handleOpenTsModal={tailscale.handleOpenTsModal}
        setTsLoading={tailscale.setTsLoading}
        setTsConnecting={tailscale.setTsConnecting}
        setTsProgress={tailscale.setTsProgress}
        setTsStatus={tailscale.setTsStatus}
        clearUserAuth={tailscale.clearUserAuth}
        requireApiKey={settings.requireApiKey}
        requireLogin={settings.requireLogin}
        hasPassword={settings.hasPassword}
        tunnelDashboardAccess={settings.tunnelDashboardAccess}
        handleTunnelDashboardAccess={settings.handleTunnelDashboardAccess}
        isLoginUnsafe={isLoginUnsafe}
        unsafeReason={unsafeReason}
      />

      <ApiKeysCard
        keys={apiKeys.keys}
        setShowAddModal={apiKeys.setShowAddModal}
        requireApiKey={settings.requireApiKey}
        handleRequireApiKey={settings.handleRequireApiKey}
        isRemoteHost={settings.isRemoteHost}
        visibleKeys={apiKeys.visibleKeys}
        copied={copied}
        copy={copy}
        maskKey={apiKeys.maskKey}
        toggleKeyVisibility={apiKeys.toggleKeyVisibility}
        setConfirmState={apiKeys.setConfirmState}
        handleToggleKey={apiKeys.handleToggleKey}
        handleDeleteKey={apiKeys.handleDeleteKey}
      />

      <EndpointModals
        showAddModal={apiKeys.showAddModal}
        setShowAddModal={apiKeys.setShowAddModal}
        newKeyName={apiKeys.newKeyName}
        setNewKeyName={apiKeys.setNewKeyName}
        handleCreateKey={apiKeys.handleCreateKey}
        createdKey={apiKeys.createdKey}
        setCreatedKey={apiKeys.setCreatedKey}
        copied={copied}
        copy={copy}
        showEnableTunnelModal={tunnel.showEnableTunnelModal}
        setShowEnableTunnelModal={tunnel.setShowEnableTunnelModal}
        handleEnableTunnel={tunnel.handleEnableTunnel}
        showDisableTunnelModal={tunnel.showDisableTunnelModal}
        setShowDisableTunnelModal={tunnel.setShowDisableTunnelModal}
        handleDisableTunnel={tunnel.handleDisableTunnel}
        tunnelLoading={tunnel.tunnelLoading}
        showTsModal={tailscale.showTsModal}
        setShowTsModal={tailscale.setShowTsModal}
        tsInstalled={tailscale.tsInstalled}
        tsInstalling={tailscale.tsInstalling}
        tsInstallLog={tailscale.tsInstallLog}
        tsSudoPassword={tailscale.tsSudoPassword}
        setTsSudoPassword={tailscale.setTsSudoPassword}
        tsStatus={tailscale.tsStatus}
        handleInstallTailscale={tailscale.handleInstallTailscale}
        handleConnectTailscale={tailscale.handleConnectTailscale}
        tsLogRef={tailscale.tsLogRef}
        showDisableTsModal={tailscale.showDisableTsModal}
        setShowDisableTsModal={tailscale.setShowDisableTsModal}
        handleDisableTailscale={tailscale.handleDisableTailscale}
        tsLoading={tailscale.tsLoading}
        confirmState={apiKeys.confirmState}
        setConfirmState={apiKeys.setConfirmState}
      />
    </div>
  );
}

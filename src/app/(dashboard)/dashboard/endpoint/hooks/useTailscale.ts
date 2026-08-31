"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { MutableRefObject, Dispatch, SetStateAction } from "react";
import { translate } from "@/i18n/runtime";
import {
  TUNNEL_PING_INTERVAL_MS,
  TUNNEL_PING_MAX_MS,
  REACHABLE_MISS_THRESHOLD,
} from "../endpointConstants";
import type { StatusInfo } from "../types";

export function useTailscale() {
  const [tsEnabled, setTsEnabled] = useState(false);
  const [tsReachable, setTsReachable] = useState(false);
  const [tsUrl, setTsUrl] = useState("");
  const [tsLoading, setTsLoading] = useState(false);
  const [tsProgress, setTsProgress] = useState("");
  const [tsStatus, setTsStatus] = useState<StatusInfo | null>(null);
  const [tsAuthUrl, setTsAuthUrl] = useState("");
  const [tsAuthLabel, setTsAuthLabel] = useState("");
  const [tsInstalled, setTsInstalled] = useState<boolean | null>(null); // null=checking, true/false
  const [tsInstalling, setTsInstalling] = useState(false);
  const [tsInstallLog, setTsInstallLog] = useState<string[]>([]);
  const [tsSudoPassword, setTsSudoPassword] = useState("");
  const [tsConnecting, setTsConnecting] = useState(false);
  const [showTsModal, setShowTsModal] = useState(false);
  const [showDisableTsModal, setShowDisableTsModal] = useState(false);
  const [tsEverReachable, setTsEverReachable] = useState(false);

  const tsLogRef = useRef<HTMLDivElement>(null);
  // Debounce reachable=false
  const tsMissRef = useRef(0);
  // Browser-side reachable cache
  const tsClientReachableRef = useRef(false);
  // Track whether reachable=true was ever observed
  const tsEverReachableRef = useRef(false);

  // Auto-scroll install log
  useEffect(() => {
    if (tsLogRef.current) tsLogRef.current.scrollTop = tsLogRef.current.scrollHeight;
  }, [tsInstallLog]);

  // Client-side reachable only. Miss-debounce: only flip to false after N consecutive misses.
  const updateReachable = useCallback((clientRef: MutableRefObject<boolean>, missRef: MutableRefObject<number>, setter: Dispatch<SetStateAction<boolean>>, everRef: MutableRefObject<boolean>, everSetter: Dispatch<SetStateAction<boolean>>) => {
    const reachable = clientRef.current;
    if (reachable) {
      missRef.current = 0;
      setter(true);
      if (!everRef.current) {
        everRef.current = true;
        everSetter(true);
      }
    } else {
      missRef.current += 1;
      if (missRef.current >= REACHABLE_MISS_THRESHOLD) setter(false);
    }
  }, []);

  const syncFromStatus = useCallback((data: Record<string, unknown>) => {
    const tailscale = data.tailscale as Record<string, unknown> | undefined;
    const tsEn = (tailscale?.settingsEnabled ?? tailscale?.enabled ?? false) as boolean;
    const tsUrlVal = (tailscale?.tunnelUrl || "") as string;
    setTsUrl(tsUrlVal);
    setTsEnabled(tsEn);
    updateReachable(tsClientReachableRef, tsMissRef, setTsReachable, tsEverReachableRef, setTsEverReachable);
  }, [updateReachable]);

  const checkTailscaleInstalled = async () => {
    setTsInstalled(null);
    try {
      const res = await fetch("/api/tunnel/tailscale-check");
      if (res.ok) {
        const data = await res.json();
        setTsInstalled(data.installed);
        return data;
      }
    } catch { /* ignore */ }
    setTsInstalled(false);
    return { installed: false };
  };

  const handleInstallTailscale = async () => {
    setTsInstalling(true);
    setTsStatus(null);
    setTsInstallLog([]);
    try {
      const res = await fetch("/api/tunnel/tailscale-install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sudoPassword: tsSudoPassword }),
      });
      setTsSudoPassword("");

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const lines = part.split("\n");
          let event = "progress";
          let data = null;
          for (const line of lines) {
            if (line.startsWith("event: ")) event = line.slice(7).trim();
            if (line.startsWith("data: ")) {
              try { data = JSON.parse(line.slice(6)); } catch { /* skip */ }
            }
          }
          if (!data) continue;
          if (event === "progress") {
            setTsInstallLog((prev) => [...prev.slice(-50), data.message]);
          } else if (event === "done") {
            setTsInstalled(true);
            setTsInstalling(false);
            setShowTsModal(false);
            handleConnectTailscale();
            return;
          } else if (event === "error") {
            setTsStatus({ type: "error", message: data.error || (translate("Installation failed") || "Installation failed") });
          }
        }
      }
    } catch (e: unknown) {
      setTsStatus({ type: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setTsInstalling(false);
    }
  };

  // Ping Tailscale health until reachable
  const pingTsHealth = async (url: string) => {
    setTsProgress(translate("Waiting for Tailscale to be ready...") || "Waiting for Tailscale to be ready...");
    const healthUrl = `${url}/api/health`;
    const start = Date.now();
    while (Date.now() - start < TUNNEL_PING_MAX_MS) {
      await new Promise((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
      try {
        const ping = await fetch(healthUrl, { mode: "no-cors", cache: "no-store" });
        if (ping.ok || ping.type === "opaque") return true;
      } catch { /* not ready yet */ }
    }
    return false;
  };

  // Show inline login button instead of auto-opening popup (browsers block popups
  // opened after async work because the user gesture is lost).
  const requestUserAuth = (url: string, label: string) => {
    setTsAuthUrl(url);
    setTsAuthLabel(label);
  };

  const clearUserAuth = () => {
    setTsAuthUrl("");
    setTsAuthLabel("");
  };

  const handleConnectTailscale = async () => {
    setShowTsModal(false);
    setTsConnecting(true);
    setTsLoading(true);
    setTsStatus(null);
    setTsProgress(translate("Connecting...") || "Connecting...");
    clearUserAuth();
    try {
      const res = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
      const data = await res.json();

      if (res.ok && data.success) {
        setTsUrl(data.tunnelUrl || "");
        const reachable = await pingTsHealth(data.tunnelUrl);
        setTsEnabled(true);
        setTsStatus(reachable ? null : { type: "warning", message: translate("Connected but not reachable yet.") || "Connected but not reachable yet." });
        return;
      }

      if (data.needsLogin && data.authUrl) {
        requestUserAuth(data.authUrl, translate("Open Login Page") || "Open Login Page");
        setTsProgress(`${translate("Login required — click") || "Login required — click"} "${translate("Open Login Page") || "Open Login Page"}" ${translate("to continue") || "to continue"}`);
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          try {
            const r2 = await fetch("/api/tunnel/tailscale-check");
            if (r2.ok) {
              const check = await r2.json();
              if (check.loggedIn) {
                clearUserAuth();
                setTsProgress(translate("Starting funnel...") || "Starting funnel...");
                const res2 = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
                const data2 = await res2.json();
                if (res2.ok && data2.success) {
                  setTsUrl(data2.tunnelUrl || "");
                  const ok2 = await pingTsHealth(data2.tunnelUrl);
                  setTsEnabled(true);
                  setTsStatus(ok2 ? null : { type: "warning", message: "Connected but not reachable yet." });
                } else if (data2.funnelNotEnabled && data2.enableUrl) {
                  await pollFunnelEnable(data2.enableUrl);
                } else {
                  setTsStatus({ type: "error", message: data2.error || (translate("Failed to start funnel") || "Failed to start funnel") });
                }
                return;
              }
            }
          } catch { /* retry */ }
        }
        clearUserAuth();
        setTsStatus({ type: "error", message: translate("Login expired. Please try again.") || "Login expired. Please try again." });
        return;
      }

      if (data.funnelNotEnabled && data.enableUrl) {
        await pollFunnelEnable(data.enableUrl);
        return;
      }

      setTsStatus({ type: "error", message: data.error || (translate("Failed to connect") || "Failed to connect") });
    } catch (e: unknown) {
      setTsStatus({ type: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setTsLoading(false);
      setTsConnecting(false);
      setTsProgress("");
      clearUserAuth();
    }
  };

  const pollFunnelEnable = async (enableUrl: string) => {
    requestUserAuth(enableUrl, translate("Open Funnel Settings") || "Open Funnel Settings");
    setTsProgress(`${translate("Click") || "Click"} "${translate("Open Funnel Settings") || "Open Funnel Settings"}" ${translate("to enable Funnel...") || "to enable Funnel..."}`);
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetch("/api/tunnel/tailscale-enable", { method: "POST" });
        const data = await res.json();
        if (res.ok && data.success) {
          clearUserAuth();
          setTsUrl(data.tunnelUrl || "");
          const ok3 = await pingTsHealth(data.tunnelUrl);
          setTsEnabled(true);
          setTsStatus(ok3 ? null : { type: "warning", message: "Connected but not reachable yet." });
          return;
        }
        if (data.funnelNotEnabled) continue;
        if (data.error) {
          clearUserAuth();
          setTsStatus({ type: "error", message: data.error });
          return;
        }
      } catch { /* retry */ }
    }
    clearUserAuth();
    setTsStatus({ type: "error", message: translate("Timed out waiting for Funnel to be enabled.") || "Timed out waiting for Funnel to be enabled." });
  };

  const handleDisableTailscale = async () => {
    setTsLoading(true);
    setTsStatus(null);
    try {
      const res = await fetch("/api/tunnel/tailscale-disable", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setTsEnabled(false);
        setTsUrl("");
        setShowDisableTsModal(false);
        setTsStatus({ type: "success", message: translate("Tailscale disabled") || "Tailscale disabled" });
      } else {
        setTsStatus({ type: "error", message: data.error || (translate("Failed to disable Tailscale") || "Failed to disable Tailscale") });
      }
    } catch (e: unknown) {
      setTsStatus({ type: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setTsLoading(false);
    }
  };

  const handleOpenTsModal = async () => {
    setTsStatus(null);
    setTsInstallLog([]);
    const data = await checkTailscaleInstalled();
    if (data?.installed && data?.hasCachedPassword) {
      handleConnectTailscale();
    } else {
      setShowTsModal(true);
    }
  };

  return {
    tsEnabled, setTsEnabled, tsReachable, setTsReachable, tsUrl, setTsUrl,
    tsLoading, setTsLoading, tsProgress, setTsProgress, tsStatus, setTsStatus,
    tsAuthUrl, tsAuthLabel, tsInstalled, setTsInstalled, tsInstalling,
    tsInstallLog, tsSudoPassword, setTsSudoPassword, tsConnecting, setTsConnecting,
    showTsModal, setShowTsModal, showDisableTsModal, setShowDisableTsModal,
    tsEverReachable, setTsEverReachable, tsLogRef, tsMissRef, tsClientReachableRef, tsEverReachableRef,
    updateReachable, syncFromStatus, checkTailscaleInstalled,
    handleInstallTailscale, pingTsHealth, requestUserAuth, clearUserAuth,
    handleConnectTailscale, pollFunnelEnable, handleDisableTailscale, handleOpenTsModal,
  };
}

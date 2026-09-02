"use client";

import { useState, useRef, useCallback } from "react";
import type { MutableRefObject, Dispatch, SetStateAction } from "react";
import { translate } from "@/i18n/runtime";
import {
  TUNNEL_PING_INTERVAL_MS,
  TUNNEL_PING_MAX_MS,
  REACHABLE_MISS_THRESHOLD,
} from "../endpointConstants";
import type { StatusInfo } from "../types";

const LOCAL_ONLY_MESSAGE: string =
  translate("Cloudflare Tunnel requires a local ModelHub instance — not available on this hosted deployment.") ||
  "Cloudflare Tunnel requires a local ModelHub instance — not available on this hosted deployment.";

export function useTunnel() {
  const [tunnelChecking, setTunnelChecking] = useState(true);
  const [tunnelEnabled, setTunnelEnabled] = useState(false);
  const [tunnelReachable, setTunnelReachable] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState("");
  const [tunnelPublicUrl, setTunnelPublicUrl] = useState("");
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const [tunnelProgress, setTunnelProgress] = useState("");
  const [tunnelStatus, setTunnelStatus] = useState<StatusInfo | null>(null);
  const [showEnableTunnelModal, setShowEnableTunnelModal] = useState(false);
  const [showDisableTunnelModal, setShowDisableTunnelModal] = useState(false);
  const [tunnelEverReachable, setTunnelEverReachable] = useState(false);

  // Debounce reachable=false: server may briefly return false during background refresh.
  const tunnelMissRef = useRef(0);
  // Browser-side reachable cache (independent of backend DNS quirks)
  const tunnelClientReachableRef = useRef(false);
  // Track whether reachable=true was ever observed in this session.
  const tunnelEverReachableRef = useRef(false);

  // Client-side reachable only (server no longer probes; watchdog handles backend health).
  // Miss-debounce: only flip to false after N consecutive misses.
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
    const tunnel = data.tunnel as Record<string, unknown> | undefined;
    const tEnabled = (tunnel?.settingsEnabled ?? tunnel?.enabled ?? false) as boolean;
    const tUrl = (tunnel?.tunnelUrl || "") as string;
    setTunnelUrl(tUrl);
    setTunnelPublicUrl((tunnel?.publicUrl || "") as string);
    setTunnelEnabled(tEnabled);
    updateReachable(tunnelClientReachableRef, tunnelMissRef, setTunnelReachable, tunnelEverReachableRef, setTunnelEverReachable);
  }, [updateReachable]);

  // Ping tunnel health until reachable. Race multiple URLs (shortlink + direct) — 1 OK is enough.
  const pingTunnelHealth = async (...urls: string[]) => {
    setTunnelLoading(true);
    setTunnelProgress(translate("Waiting for tunnel to be ready...") || "Waiting for tunnel to be ready...");
    const targets = urls.filter(Boolean).map((u) => `${u}/api/health`);
    const start = Date.now();
    while (Date.now() - start < TUNNEL_PING_MAX_MS) {
      await new Promise((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
      const ok = await Promise.any(targets.map(async (h) => {
        const p = await fetch(h, { mode: "cors", cache: "no-store" });
        if (p.ok) return true;
        throw new Error("not ready");
      })).catch(() => false);
      if (ok) {
        setTunnelEnabled(true);
        setTunnelLoading(false);
        setTunnelProgress("");
        return true;
      }
      // Every 5 pings (~10s), check if backend process still alive
      if ((Date.now() - start) % 10000 < TUNNEL_PING_INTERVAL_MS) {
        try {
          const statusRes = await fetch("/api/tunnel/status");
          if (statusRes.ok) {
            const status = await statusRes.json();
            if (!status.tunnel?.enabled) {
              setTunnelStatus({ type: "error", message: translate("Tunnel process stopped unexpectedly.") || "Tunnel process stopped unexpectedly." });
              setTunnelLoading(false);
              setTunnelProgress("");
              return false;
            }
          }
        } catch { /* ignore */ }
      }
    }
    setTunnelStatus({ type: "error", message: translate("Tunnel created but not reachable. Please try again.") || "Tunnel created but not reachable. Please try again." });
    setTunnelLoading(false);
    setTunnelProgress("");
    return false;
  };

  const handleEnableTunnel = async () => {
    setShowEnableTunnelModal(false);
    setTunnelLoading(true);
    setTunnelStatus(null);
    setTunnelProgress(translate("Creating tunnel...") || "Creating tunnel...");

    // Poll download progress while enable request is pending
    let polling = true;
    const pollProgress = async () => {
      while (polling) {
        try {
          const r = await fetch("/api/tunnel/status");
          if (r.ok) {
            const s = await r.json();
            if (s.download?.downloading) {
              setTunnelProgress(`${translate("Downloading cloudflared...") || "Downloading cloudflared..."} ${s.download.progress}%`);
            } else if (polling) {
              setTunnelProgress(translate("Creating tunnel...") || "Creating tunnel...");
            }
          }
        } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, 1000));
      }
    };
    pollProgress();

    try {
      const res = await fetch("/api/tunnel/enable", { method: "POST" });
      polling = false;
      if (res.status === 403) {
        setTunnelStatus({ type: "info", message: LOCAL_ONLY_MESSAGE });
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setTunnelStatus({ type: "error", message: data.error || (translate("Failed to enable tunnel") || "Failed to enable tunnel") });
        return;
      }

      const url = data.tunnelUrl;
      if (!url) {
        setTunnelStatus({ type: "error", message: translate("No tunnel URL returned") || "No tunnel URL returned" });
        return;
      }

      setTunnelUrl(url);
      setTunnelPublicUrl(data.publicUrl || "");
      await pingTunnelHealth(data.publicUrl, url);
    } catch (e: unknown) {
      setTunnelStatus({ type: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      polling = false;
      setTunnelLoading(false);
      setTunnelProgress("");
    }
  };

  const handleDisableTunnel = async () => {
    setTunnelLoading(true);
    setTunnelStatus(null);
    try {
      const res = await fetch("/api/tunnel/disable", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setTunnelEnabled(false);
        setTunnelUrl("");
        setShowDisableTunnelModal(false);
        setTunnelStatus({ type: "success", message: translate("Tunnel disabled") || "Tunnel disabled" });
      } else {
        setTunnelStatus({ type: "error", message: data.error || (translate("Failed to disable tunnel") || "Failed to disable tunnel") });
      }
    } catch (e: unknown) {
      setTunnelStatus({ type: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setTunnelLoading(false);
    }
  };

  const loadTunnelStatus = async () => {
    setTunnelChecking(true);
    try {
      const res = await fetch("/api/tunnel/status", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        syncFromStatus(data);
      } else if (res.status === 403) {
        setTunnelStatus({ type: "info", message: LOCAL_ONLY_MESSAGE });
      }
    } catch (error) {
      console.error("Error loading settings:", error);
    } finally {
      setTunnelChecking(false);
    }
  };

  return {
    tunnelChecking, setTunnelChecking, tunnelEnabled, setTunnelEnabled,
    tunnelReachable, setTunnelReachable, tunnelUrl, tunnelPublicUrl,
    tunnelLoading, setTunnelLoading, tunnelProgress, setTunnelProgress,
    tunnelStatus, setTunnelStatus, showEnableTunnelModal, setShowEnableTunnelModal,
    showDisableTunnelModal, setShowDisableTunnelModal, tunnelEverReachable, setTunnelEverReachable,
    tunnelMissRef, tunnelClientReachableRef, tunnelEverReachableRef,
    updateReachable, syncFromStatus, pingTunnelHealth,
    handleEnableTunnel, handleDisableTunnel, loadTunnelStatus,
  };
}

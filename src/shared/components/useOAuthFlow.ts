"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

// Providers using the dynamic-port local callback proxy.
// Browser OAuth: popup → auto callback → auto exchange → poll-status.
export const PROXY_OAUTH_PROVIDERS = new Set(["trae", "windsurf", "zed"]);

// Providers offering a paste-token fallback (import-token flow).
// UX warns if the IDE (which issues the token) is not installed.
export const PASTE_TOKEN_PROVIDERS: Record<string, { label: string; instructions: string; placeholder: string; ideName: string; ideOptional: boolean }> = {
  trae: {
    label: "Cloud-IDE-JWT",
    instructions:
      "Sign in at trae.ai (or solo.trae.ai), open DevTools → Network, copy the Cloud-IDE-JWT token from any request's Authorization header (~14-day lifetime).",
    placeholder: "Paste Cloud-IDE-JWT here...",
    ideName: "Trae",
    ideOptional: true,
  },
  windsurf: {
    label: "Windsurf API key",
    instructions:
      "In the Windsurf/VS Code IDE, run the \"Windsurf: Provide Auth Token\" command, then copy the displayed sk-ws-... key.",
    placeholder: "Paste sk-ws-... key here...",
    ideName: "Windsurf",
    ideOptional: false,
  },
};

export interface ProviderInfo {
  name?: string;
}

export interface UseOAuthFlowProps {
  isOpen: boolean;
  provider?: string;
  onSuccess?: () => void;
  onClose: () => void;
  oauthMeta?: Record<string, string>;
  /** Optional Kiro IDC config for AWS IAM Identity Center device flow */
  idcConfig?: {
    startUrl?: string;
    region?: string;
  };
}

/**
 * Encapsulates all OAuth state, effects, and action handlers.
 * Extracted verbatim from OAuthModal.tsx.
 */
export function useOAuthFlow({ isOpen, provider, onSuccess, onClose, oauthMeta, idcConfig }: UseOAuthFlowProps) {
  const [step, setStep] = useState<"waiting" | "input" | "success" | "error">("waiting");
  const [authData, setAuthData] = useState<Record<string, unknown> | null>(null);
  const [callbackUrl, setCallbackUrl] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isDeviceCode, setIsDeviceCode] = useState<boolean>(false);
  const [deviceData, setDeviceData] = useState<Record<string, unknown> | null>(null);
  const [polling, setPolling] = useState<boolean>(false);
  const [authMode, setAuthMode] = useState<"browser" | "paste-token">("browser");
  const [pasteToken, setPasteToken] = useState<string>("");
  const [ideStatus, setIdeStatus] = useState<{ installed: boolean; path: string | null } | null>(null);
  const popupRef = useRef<Window | null>(null);
  const pollingAbortRef = useRef<boolean>(false);
  const openedRef = useRef<boolean>(false);
  const { copied, copy } = useCopyToClipboard();

  const [isLocalhost, setIsLocalhost] = useState<boolean>(false);
  const [placeholderUrl, setPlaceholderUrl] = useState<string>("/callback?code=...");
  const callbackProcessedRef = useRef<boolean>(false);

  // Detect if running on localhost (client-side only)
  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsLocalhost(
        window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      );
      setPlaceholderUrl(`${window.location.origin}/callback?code=...`);
    }
  }, []);

  // Exchange tokens
  const exchangeTokens = useCallback(async (code: string, state: string | null) => {
    if (!authData) return;
    try {
      const res = await fetch(`/api/oauth/${provider}/exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          redirectUri: authData.redirectUri,
          codeVerifier: authData.codeVerifier,
          state,
          ...(oauthMeta ? { meta: oauthMeta } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setStep("success");
      onSuccess?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  }, [authData, provider, onSuccess, oauthMeta]);

  const completeXaiManualCode = useCallback(async (code: string) => {
    if (!authData?.state) return;
    try {
      const res = await fetch("/api/oauth/xai/manual-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, state: authData.state }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setStep("success");
      onSuccess?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  }, [authData, onSuccess]);

  // Poll for device code token
  const startPolling = useCallback(async (deviceCode: string, codeVerifier: string, interval: number, extraData: Record<string, unknown> | null, deadlineMs?: number) => {
    pollingAbortRef.current = false;
    setPolling(true);
    const startedAt = Date.now();
    const deadline = startedAt + (Number.isFinite(deadlineMs) && deadlineMs && deadlineMs > 0 ? deadlineMs : 120_000);

    while (Date.now() < deadline) {
      if (pollingAbortRef.current) {
        console.error("[OAuthModal] Polling aborted");
        setPolling(false);
        return;
      }

      await new Promise((r) => setTimeout(r, interval * 1000));

      if (pollingAbortRef.current) {
        console.error("[OAuthModal] Polling aborted after sleep");
        setPolling(false);
        return;
      }

      try {
        const res = await fetch(`/api/oauth/${provider}/poll`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceCode, codeVerifier, extraData }),
        });

        const data = await res.json();

        if (data.success) {
          pollingAbortRef.current = true;
          setStep("success");
          setPolling(false);
          onSuccess?.();
          return;
        }

        if (data.error === "expired_token" || data.error === "access_denied") {
          throw new Error(data.errorDescription || data.error);
        }

        if (data.error === "slow_down") {
          interval = Math.min(interval + 5, 30);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
        setStep("error");
        setPolling(false);
        return;
      }
    }

    setError("Authorization timeout");
    setStep("error");
    setPolling(false);
  }, [provider, onSuccess]);

  // Trae/Windsurf proxy OAuth flow
  const startProxyFlow = useCallback(async (providerId: string) => {
    const startRes = await fetch(`/api/oauth/${providerId}/start-proxy`);
    const startData = await startRes.json();
    if (!startRes.ok || !startData.success || !startData.callbackUrl) {
      throw new Error(startData.reason || startData.error || `Failed to start ${providerId} callback server`);
    }
    const authorizeUrl = new URL(`/api/oauth/${providerId}/authorize`, window.location.origin);
    authorizeUrl.searchParams.set("redirect_uri", startData.callbackUrl);
    const authRes = await fetch(authorizeUrl);
    const authDataRes = await authRes.json();
    if (!authRes.ok) throw new Error(authDataRes.error);
    const regBody: Record<string, unknown> = { state: authDataRes.state };
    if (authDataRes.codeVerifier) regBody.codeVerifier = authDataRes.codeVerifier;
    await fetch(`/api/oauth/${providerId}/register-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(regBody),
    });
    setAuthData({ ...authDataRes, proxyProvider: providerId });
    setStep("waiting");
    popupRef.current = window.open(authDataRes.authUrl, "oauth_popup", "width=600,height=700");
    if (!popupRef.current) setStep("input");
  }, []);

  // Start OAuth flow
  const startOAuthFlow = useCallback(async () => {
    if (!provider) return;
    try {
      setError(null);

      if (PROXY_OAUTH_PROVIDERS.has(provider) && authMode === "browser") {
        await startProxyFlow(provider);
        return;
      }

      const deviceCodeProviders = [
        "github",
        "kiro",
        "kimi",
        "kimi-coding",
        "kilocode",
        "codebuddy-cn",
        "codebuddy-intl",
        "qoder",
        "grok-cli",
      ];
      if (deviceCodeProviders.includes(provider)) {
        setIsDeviceCode(true);
        setStep("waiting");

        const deviceCodeUrl = new URL(`/api/oauth/${provider}/device-code`, window.location.origin);
        if (provider === "kiro" && idcConfig?.startUrl) {
          deviceCodeUrl.searchParams.set("start_url", idcConfig.startUrl);
          if (idcConfig.region) {
            deviceCodeUrl.searchParams.set("region", idcConfig.region);
          }
          deviceCodeUrl.searchParams.set("auth_method", "idc");
        }
        const res = await fetch(deviceCodeUrl.toString());
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        setDeviceData(data);

        const verifyUrl = data.verification_uri_complete || data.verification_uri;
        if (verifyUrl) window.open(verifyUrl, "_blank", "noopener,noreferrer");

        const extraData = provider === "kiro"
          ? {
              _clientId: data._clientId,
              _clientSecret: data._clientSecret,
              _region: data._region,
              _authMethod: data._authMethod,
              _startUrl: data._startUrl,
            }
          : provider === "qoder"
          ? {
              _qoderNonce: data._qoderNonce,
              _qoderMachineId: data._qoderMachineId,
              _qoderVerifier: data.codeVerifier,
            }
          : (provider === "kimi" || provider === "kimi-coding")
          ? { _kimiDeviceId: data._kimiDeviceId }
          : null;
        startPolling(
          data.device_code,
          data.codeVerifier,
          data.interval || 5,
          extraData,
          Number.isFinite(data.expires_in) && data.expires_in > 0
            ? data.expires_in * 1000
            : undefined,
        );
        return;
      }

      const appPort = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
      let redirectUri: string;
      if (provider === "codex") {
        redirectUri = "http://localhost:1455/auth/callback";
      } else if (provider === "xai") {
        redirectUri = "http://127.0.0.1:56121/callback";
      } else {
        redirectUri = `http://localhost:${appPort}/callback`;
      }

      const authorizeUrl = new URL(`/api/oauth/${provider}/authorize`, window.location.origin);
      authorizeUrl.searchParams.set("redirect_uri", redirectUri);
      if (oauthMeta) {
        Object.entries(oauthMeta).forEach(([k, v]) => { if (v) authorizeUrl.searchParams.set(k, v); });
      }
      const res = await fetch(authorizeUrl.toString());
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      let codexProxyActive = false;
      let codexServerSide = false;
      if (provider === "codex") {
        try {
          const proxyUrl = new URL(`/api/oauth/codex/start-proxy`, window.location.origin);
          proxyUrl.searchParams.set("app_port", appPort);
          proxyUrl.searchParams.set("state", data.state);
          proxyUrl.searchParams.set("code_verifier", data.codeVerifier);
          proxyUrl.searchParams.set("redirect_uri", redirectUri);
          const proxyRes = await fetch(proxyUrl.toString());
          const proxyData = await proxyRes.json();
          codexProxyActive = proxyData.success;
          codexServerSide = !!proxyData.serverSide;
        } catch {
          codexProxyActive = false;
        }
      }

      let xaiProxyActive = false;
      let xaiServerSide = false;
      if (provider === "xai") {
        try {
          const proxyUrl = new URL(`/api/oauth/xai/start-proxy`, window.location.origin);
          proxyUrl.searchParams.set("app_port", appPort);
          proxyUrl.searchParams.set("state", data.state);
          proxyUrl.searchParams.set("code_verifier", data.codeVerifier);
          proxyUrl.searchParams.set("redirect_uri", redirectUri);
          const proxyRes = await fetch(proxyUrl.toString());
          const proxyData = await proxyRes.json();
          xaiProxyActive = proxyData.success;
          xaiServerSide = !!proxyData.serverSide;
          if (!xaiProxyActive && proxyData.reason === "port_busy") {
            throw new Error("Port 56121 in use; close the conflicting process and retry");
          }
        } catch (e: unknown) {
          if (e instanceof Error && e?.message) throw e;
          xaiProxyActive = false;
        }
      }

      setAuthData({ ...data, redirectUri, codexServerSide, xaiServerSide });

      if (!data.authUrl) {
        if (data.flowType === "device_code") {
          throw new Error(
            `Provider ${provider} uses device-code login but is not wired in the OAuth modal device-code list`
          );
        }
        throw new Error("No authorization URL returned from OAuth provider");
      }

      if (provider === "codex" && codexProxyActive) {
        setStep("waiting");
        popupRef.current = window.open(data.authUrl, "oauth_popup", "width=600,height=700");
        if (!popupRef.current) {
          setStep("input");
        }
      } else if (provider === "xai" && xaiProxyActive) {
        setStep("waiting");
        popupRef.current = window.open(data.authUrl, "oauth_popup", "width=600,height=700");
        if (!popupRef.current) {
          setStep("input");
        }
      } else if (!isLocalhost || provider === "codex" || provider === "xai") {
        setStep("input");
        window.open(data.authUrl, "_blank");
      } else {
        setStep("waiting");
        popupRef.current = window.open(data.authUrl, "oauth_popup", "width=600,height=700");
        if (!popupRef.current) {
          setStep("input");
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  }, [provider, isLocalhost, startPolling, oauthMeta, idcConfig, authMode, startProxyFlow]);

  // Reset state and start OAuth when modal opens
  useEffect(() => {
    if (isOpen && provider) {
      if (openedRef.current) return;
      openedRef.current = true;
      setAuthData(null);
      setCallbackUrl("");
      setError(null);
      setIsDeviceCode(false);
      setDeviceData(null);
      setPolling(false);
      setAuthMode("browser");
      setPasteToken("");
      setIdeStatus(null);
      pollingAbortRef.current = false;
      if (PASTE_TOKEN_PROVIDERS[provider]) {
        fetch(`/api/oauth/${provider}/ide-status`)
          .then((r) => r.json())
          .then((data) => setIdeStatus(data))
          .catch(() => setIdeStatus({ installed: false, path: null }));
      }
      startOAuthFlow();
    } else if (!isOpen) {
      pollingAbortRef.current = true;
      openedRef.current = false;
      if (provider === "codex") {
        fetch("/api/oauth/codex/stop-proxy").catch(() => {});
      } else if (provider === "xai") {
        fetch("/api/oauth/xai/stop-proxy").catch(() => {});
      } else if (provider === "trae") {
        fetch("/api/oauth/trae/stop-proxy").catch(() => {});
      } else if (provider === "windsurf") {
        fetch("/api/oauth/windsurf/stop-proxy").catch(() => {});
      } else if (provider === "zed") {
        fetch("/api/oauth/zed/stop-proxy").catch(() => {});
      }
    }
  }, [isOpen, provider, startOAuthFlow]);

  // Server-side proxy mode polling
  useEffect(() => {
    const pollProvider = authData?.codexServerSide
      ? "codex"
      : authData?.xaiServerSide
        ? "xai"
        : authData?.proxyProvider
          ? authData.proxyProvider
          : null;
    if (!pollProvider || !authData?.state) return;
    if (callbackProcessedRef.current) return;
    let cancelled = false;
    const POLL_INTERVAL_MS = 1500;
    const MAX_ATTEMPTS = 200;
    let attempts = 0;

    const tick = async () => {
      if (cancelled || callbackProcessedRef.current) return;
      attempts += 1;
      try {
          const res = await fetch(`/api/oauth/${pollProvider}/poll-status?state=${encodeURIComponent(authData.state as string)}`);
        const data = await res.json();
        if (cancelled || callbackProcessedRef.current) return;
        if (data.status === "done") {
          callbackProcessedRef.current = true;
          setStep("success");
          onSuccess?.();
          return;
        }
        if (data.status === "error") {
          callbackProcessedRef.current = true;
          setError(data.error || "Authentication failed");
          setStep("error");
          return;
        }
      } catch {
        // Network error, keep polling
      }
      if (attempts >= MAX_ATTEMPTS) {
        callbackProcessedRef.current = true;
        setError("Authentication timeout");
        setStep("error");
        return;
      }
      setTimeout(tick, POLL_INTERVAL_MS);
    };
    setTimeout(tick, POLL_INTERVAL_MS);
    return () => { cancelled = true; };
  }, [authData, onSuccess]);

  // Listen for OAuth callback via multiple methods
  useEffect(() => {
    if (!authData) return;
    callbackProcessedRef.current = false;

    const handleCallback = async (data: { code?: string; token?: string; state?: string; error?: string; errorDescription?: string }) => {
      if (callbackProcessedRef.current) return;

      const { code, token, state, error: callbackError, errorDescription } = data;

      if (callbackError) {
        callbackProcessedRef.current = true;
        setError(errorDescription || callbackError);
        setStep("error");
        return;
      }

      if (token || code) {
        callbackProcessedRef.current = true;
        await exchangeTokens(token || code!, state || null);
      }
    };

    const handleMessage = (event: MessageEvent) => {
      const isLocalhost = event.origin.includes("localhost") || event.origin.includes("127.0.0.1");
      const isSameOrigin = event.origin === window.location.origin;
      if (!isLocalhost && !isSameOrigin) return;
      
      if (event.data?.type === "oauth_callback") {
        handleCallback(event.data.data);
      }
    };
    window.addEventListener("message", handleMessage);

    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel("oauth_callback");
      channel.onmessage = (event) => handleCallback(event.data);
    } catch { console.error("BroadcastChannel not supported");
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === "oauth_callback" && event.newValue) {
        try {
          const data = JSON.parse(event.newValue);
          handleCallback(data);
          localStorage.removeItem("oauth_callback");
        } catch (e) {
          console.error("Failed to parse localStorage data");
        }
      }
    };
    window.addEventListener("storage", handleStorage);

    try {
      const stored = localStorage.getItem("oauth_callback");
      if (stored) {
        const data = JSON.parse(stored);
        if (data.timestamp && Date.now() - data.timestamp < 30000) {
          handleCallback(data);
        }
        localStorage.removeItem("oauth_callback");
      }
    } catch {
      // localStorage may be unavailable or data may be malformed - ignore silently
    }

    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("storage", handleStorage);
      if (channel) channel.close();
    };
  }, [authData, exchangeTokens]);

  // Handle manual URL input
  const handleManualSubmit = async () => {
    try {
      setError(null);

      if (authMode === "paste-token" && provider && PASTE_TOKEN_PROVIDERS[provider]) {
        const token = pasteToken.trim();
        if (!token) throw new Error("Missing token");
        const res = await fetch(`/api/oauth/${provider}/exchange`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: token }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setStep("success");
        onSuccess?.();
        return;
      }

      const input = callbackUrl.trim();

      if (provider && PROXY_OAUTH_PROVIDERS.has(provider) && input) {
        const res = await fetch(`/api/oauth/${provider}/exchange`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: input, state: authData?.state }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setStep("success");
        onSuccess?.();
        return;
      }

      if (input.startsWith("eyJ") && input.includes(".")) {
        await exchangeTokens(input, null);
        return;
      }

      if (provider === "xai" && input && !input.includes("://") && !input.includes("?") && !input.includes("code=")) {
        await completeXaiManualCode(input);
        return;
      }

      if (provider === "kimchi" && input && !input.includes("://") && !input.includes("?")) {
        await exchangeTokens(input, null);
        return;
      }

      const url = new URL(input);
      const code = url.searchParams.get("code");
      const token = url.searchParams.get("token");
      const state = url.searchParams.get("state");
      const errorParam = url.searchParams.get("error");

      if (errorParam) {
        throw new Error(url.searchParams.get("error_description") || errorParam);
      }

      if (!code && !token) {
        throw new Error(
          provider === "xai"
            ? "Paste the callback URL or copied xAI code"
            : provider === "kimchi"
              ? "No Kimchi token found in URL"
              : "No authorization code found in URL"
        );
      }

      await exchangeTokens(token || code!, state);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  };

  // Clear session on modal close + cleanup proxy
  const handleClose = useCallback(() => {
    if (provider === "codex") {
      fetch("/api/oauth/codex/stop-proxy").catch(() => {});
    } else if (provider === "xai") {
      fetch("/api/oauth/xai/stop-proxy").catch(() => {});
    } else if (provider === "trae") {
      fetch("/api/oauth/trae/stop-proxy").catch(() => {});
    } else if (provider === "windsurf") {
      fetch("/api/oauth/windsurf/stop-proxy").catch(() => {});
    } else if (provider === "zed") {
      fetch("/api/oauth/zed/stop-proxy").catch(() => {});
    }
    onClose();
  }, [onClose, provider]);

  return {
    step,
    setStep,
    authData,
    callbackUrl,
    setCallbackUrl,
    error,
    setError,
    isDeviceCode,
    deviceData,
    polling,
    authMode,
    setAuthMode,
    pasteToken,
    setPasteToken,
    ideStatus,
    isLocalhost,
    placeholderUrl,
    copied,
    copy,
    handleManualSubmit,
    handleClose,
    startOAuthFlow,
  };
}

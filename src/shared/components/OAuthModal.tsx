"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button, Input } from "@/shared/components";
import { cn } from "@/lib/utils";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { AlertCircle, Check, CheckCircle2, Copy, ExternalLink, Loader2, X } from "lucide-react";

// Providers using the dynamic-port local callback proxy.
// Browser OAuth: popup → auto callback → auto exchange → poll-status.
const PROXY_OAUTH_PROVIDERS = new Set(["trae", "windsurf", "zed"]);

// Providers offering a paste-token fallback (import-token flow).
// UX warns if the IDE (which issues the token) is not installed.
const PASTE_TOKEN_PROVIDERS: Record<string, { label: string; instructions: string; placeholder: string; ideName: string; ideOptional: boolean }> = {
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

interface ProviderInfo {
  name?: string;
}

interface OAuthModalProps {
  isOpen: boolean;
  provider?: string;
  providerInfo?: ProviderInfo;
  onSuccess?: () => void;
  onClose: () => void;
  /** Extra metadata passed to /authorize and /exchange (e.g. gitlab clientId/baseUrl) */
  oauthMeta?: Record<string, string>;
  /** Optional Kiro IDC config for AWS IAM Identity Center device flow */
  idcConfig?: {
    startUrl?: string;
    region?: string;
  };
}

/**
 * OAuth Modal Component
 * - Localhost: Auto callback via popup message
 * - Remote: Manual paste callback URL
 */
export default function OAuthModal({ isOpen, provider, providerInfo, onSuccess, onClose, oauthMeta, idcConfig }: OAuthModalProps) {
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
    } catch ($1) { console.error("BroadcastChannel not supported");
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

  if (!provider || !providerInfo) return null;
  const isXaiProvider = provider === "xai";
  const isKimchiProvider = provider === "kimchi";
  const deviceLoginUrl = (deviceData?.verification_uri_complete as string) || (deviceData?.verification_uri as string) || "";
  const modalTitle = isXaiProvider ? "Conectar Grok Build OAuth" : `Conectar ${providerInfo.name}`;
  const manualPlaceholder = isXaiProvider
    ? "http://127.0.0.1:56121/callback?code=... or copied code"
    : isKimchiProvider
      ? `${placeholderUrl.replace("code=...", "token=...")} or copied token`
      : placeholderUrl;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "bg-surface border border-border-subtle rounded-[14px]",
          "shadow-[var(--shadow-elev)] ring-0 gap-0 p-0",
          "max-w-lg"
        )}
      >
        <div className="flex items-center justify-between p-2 border-b border-border-subtle">
          <DialogTitle className="text-lg font-semibold text-text-main ml-2">
            {modalTitle}
          </DialogTitle>
          <Button onClick={handleClose} aria-label="Fechar" variant="ghost" size="sm" className="p-1.5">
            <X className="size-5" />
          </Button>
        </div>
        <div className="p-6 max-h-[calc(85vh-100px)] overflow-y-auto custom-scrollbar">
          <div className="flex flex-col gap-4">
        {/* Trae/Windsurf: browser OAuth (proxy) + paste-token fallback */}
        {provider && PROXY_OAUTH_PROVIDERS.has(provider) && (step === "waiting" || step === "input" || step === "error") && (
          <>
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={() => { setAuthMode("browser"); setError(null); setStep("waiting"); startOAuthFlow(); }}
                variant={authMode === "browser" ? "primary" : "ghost"}
                className="flex-1"
              >
                🌐 Entrar com navegador
              </Button>
              <Button
                type="button"
                onClick={() => { setAuthMode("paste-token"); setError(null); setStep("input"); }}
                variant={authMode === "paste-token" ? "primary" : "ghost"}
                className="flex-1"
              >
                🔑 Colar token
              </Button>
            </div>

            {authMode === "browser" && (
              <>
                {step === "waiting" && (
                  <div className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg bg-sidebar/50">
                    <Loader2 className="size-4" />
                    <span className="text-sm">Aguardando autorização do navegador…</span>
                  </div>
                )}
                {step === "input" && (
                  <div className="space-y-3">
                    <p className="text-sm text-text-muted">
                      O popup foi bloqueado. Após autorizar no navegador, cole a URL de callback completa aqui:
                    </p>
                    <Input
                      value={callbackUrl}
                      onChange={(e) => setCallbackUrl(e.target.value)}
                      placeholder="http://127.0.0.1:.../callback?..."
                      className="font-mono text-xs"
                    />
                    <div className="flex gap-2">
                      <Button onClick={handleManualSubmit} fullWidth disabled={!callbackUrl}>Conectar</Button>
                      <Button onClick={handleClose} variant="ghost" fullWidth>Cancelar</Button>
                    </div>
                  </div>
                )}
              </>
            )}

            {authMode === "paste-token" && provider && (
              <div className="space-y-3">
                {ideStatus && !ideStatus.installed && (
                  <div className={`px-3 py-2 rounded-lg text-sm ${PASTE_TOKEN_PROVIDERS[provider].ideOptional ? "bg-blue-500/10 text-blue-700 dark:text-blue-300" : "bg-yellow-500/10 text-yellow-700 dark:text-yellow-300"}`}>
                    {PASTE_TOKEN_PROVIDERS[provider].ideName} IDE não detectado.
                    {PASTE_TOKEN_PROVIDERS[provider].ideOptional
                      ? " Você ainda pode obter o token pelas DevTools."
                      : ` Instale o IDE ${PASTE_TOKEN_PROVIDERS[provider].ideName} para obter o token, ou use "Entrar com navegador".`}
                  </div>
                )}
                <p className="text-sm text-text-muted">{PASTE_TOKEN_PROVIDERS[provider].instructions}</p>
                <Input
                  value={pasteToken}
                  onChange={(e) => setPasteToken(e.target.value)}
                  placeholder={PASTE_TOKEN_PROVIDERS[provider].placeholder}
                  className="font-mono text-xs"
                />
                <div className="flex gap-2">
                  <Button onClick={handleManualSubmit} fullWidth disabled={!pasteToken}>Conectar</Button>
                  <Button onClick={handleClose} variant="ghost" fullWidth>Cancelar</Button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Waiting + Manual Input combined (non-device-code, non-proxy) */}
        {(step === "waiting" || step === "input") && !isDeviceCode && !(provider && PROXY_OAUTH_PROVIDERS.has(provider)) && (
          <>
            <div className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg bg-sidebar/50">
              <Loader2 className="size-4" />
              <span className="text-sm">
                {isXaiProvider ? "Aguardando Grok Build OAuth…" : "Aguardando autorização do popup…"}
              </span>
            </div>

            <div className="flex items-center gap-3 my-1">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-text-muted uppercase tracking-wider">Ou cole a URL de callback manualmente</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium mb-2">
                  Passo 1: Abra esta {isXaiProvider ? "URL do Grok Build OAuth" : "URL"} no seu navegador
                </p>
                <div className="flex gap-2">
                  <Input value={(authData?.authUrl as string) || ""} readOnly className="flex-1 font-mono text-xs" />
                  <Button variant="secondary" icon={copied === "auth_url" ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={() => copy(authData?.authUrl as string, "auth_url")} disabled={!authData?.authUrl}>
                    Copiar
                  </Button>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">
                  Passo 2: Cole a {provider === "xai" ? "URL de callback ou código copiado" : isKimchiProvider ? "URL de callback ou token copiado" : "URL de callback"} aqui
                </p>
                <p className="text-xs text-text-muted mb-2">
                  {provider === "xai"
                    ? "Se o xAI mostrar um código em vez de redirecionar, cole esse código aqui."
                    : isKimchiProvider
                      ? "Após autorizar, copie a URL de callback completa ou token do seu navegador."
                    : "Após autorizar, copie a URL completa do seu navegador."}
                </p>
                <Input
                  value={callbackUrl}
                  onChange={(e) => setCallbackUrl(e.target.value)}
                  placeholder={manualPlaceholder}
                  className="font-mono text-xs"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleManualSubmit} fullWidth disabled={!callbackUrl}>
                Conectar
              </Button>
              <Button onClick={handleClose} variant="ghost" fullWidth>
                Cancelar
              </Button>
            </div>
          </>
        )}

        {/* Device Code Flow - Waiting */}
        {step === "waiting" && isDeviceCode && deviceData && (
          <>
            <div className="text-center py-4">
              <p className="text-sm text-text-muted mb-4">
                Acesse a URL de login abaixo e autorize:
              </p>
              <div className="bg-sidebar p-4 rounded-lg mb-4">
                <p className="text-xs text-text-muted mb-1">URL de Login</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm break-all">{deviceLoginUrl}</code>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={copied === "login_url" ? <Check className="size-4" /> : <Copy className="size-4" />}
                    onClick={() => copy(deviceLoginUrl, "login_url")}
                    disabled={!deviceLoginUrl}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<ExternalLink className="size-4" />}
                    onClick={() => window.open(deviceLoginUrl, "_blank", "noopener,noreferrer")}
                    disabled={!deviceLoginUrl}
                  >
                    Abrir
                  </Button>
                </div>
              </div>
              <div className="bg-primary/10 p-4 rounded-lg">
                <p className="text-xs text-text-muted mb-1">Seu Código</p>
                <div className="flex items-center justify-center gap-2">
                  <p className="text-2xl font-mono font-bold text-primary">{deviceData.user_code as string}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={copied === "user_code" ? <Check className="size-4" /> : <Copy className="size-4" />}
                    onClick={() => copy(deviceData.user_code as string, "user_code")}
                  />
                </div>
              </div>
            </div>
            {polling && (
              <div className="flex items-center justify-center gap-2 text-sm text-text-muted">
                <Loader2 className="size-4" />
                Aguardando autorização...
              </div>
            )}
          </>
        )}

        {/* Success Step */}
        {step === "success" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle2 className="size-4" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Conectado com Sucesso!</h3>
            <p className="text-sm text-text-muted mb-4">
              Sua conta {providerInfo.name} foi conectada.
            </p>
            <Button onClick={handleClose} fullWidth>
              Concluído
            </Button>
          </div>
        )}

        {/* Error Step */}
        {step === "error" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <AlertCircle className="size-4" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Falha na Conexão</h3>
            <p className="text-sm text-red-600 mb-4">{error}</p>
            <div className="flex gap-2">
              <Button onClick={startOAuthFlow} variant="secondary" fullWidth>
                Tentar Novamente
              </Button>
              <Button onClick={handleClose} variant="ghost" fullWidth>
                Cancelar
              </Button>
            </div>
          </div>
        )}
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

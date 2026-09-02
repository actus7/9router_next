import { PROXY_OAUTH_PROVIDERS } from "./oauthFlowConstants";

type SetStep = (step: "waiting" | "input" | "success" | "error") => void;
type SetError = (error: string | null) => void;
type SetPolling = (polling: boolean) => void;

interface ExchangeTokensParams {
  code: string;
  state: string | null;
  authData: Record<string, unknown> | null;
  provider?: string;
  oauthMeta?: Record<string, string>;
  setStep: SetStep;
  setError: SetError;
  onSuccess?: () => void;
}

export async function exchangeTokensAction({
  code, state, authData, provider, oauthMeta,
  setStep, setError, onSuccess,
}: ExchangeTokensParams) {
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
}

interface CompleteXaiManualCodeParams {
  code: string;
  authData: Record<string, unknown> | null;
  setStep: SetStep;
  setError: SetError;
  onSuccess?: () => void;
}

export async function completeXaiManualCodeAction({
  code, authData, setStep, setError, onSuccess,
}: CompleteXaiManualCodeParams) {
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
}

interface StartPollingParams {
  deviceCode: string;
  codeVerifier: string;
  interval: number;
  extraData: Record<string, unknown> | null;
  deadlineMs?: number;
  provider?: string;
  pollingAbortRef: React.MutableRefObject<boolean>;
  setStep: SetStep;
  setError: SetError;
  setPolling: SetPolling;
  onSuccess?: () => void;
}

export async function startPollingAction({
  deviceCode, codeVerifier: initialCodeVerifier, interval: initialInterval, extraData, deadlineMs,
  provider, pollingAbortRef,
  setStep, setError, setPolling, onSuccess,
}: StartPollingParams) {
  pollingAbortRef.current = false;
  setPolling(true);
  const startedAt = Date.now();
  const deadline = startedAt + (Number.isFinite(deadlineMs) && deadlineMs && deadlineMs > 0 ? deadlineMs : 120_000);
  let interval = initialInterval;
  const codeVerifier = initialCodeVerifier;

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
}

interface StartProxyFlowParams {
  providerId: string;
  setAuthData: (data: Record<string, unknown>) => void;
  setStep: SetStep;
  popupRef: React.MutableRefObject<Window | null>;
}

export async function startProxyFlowAction({
  providerId, setAuthData, setStep, popupRef,
}: StartProxyFlowParams) {
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
}

interface HandleManualSubmitParams {
  authMode: "browser" | "paste-token";
  provider?: string;
  pasteToken: string;
  callbackUrl: string;
  authData: Record<string, unknown> | null;
  setStep: SetStep;
  setError: SetError;
  onSuccess?: () => void;
  exchangeTokens: (code: string, state: string | null) => Promise<void>;
  completeXaiManualCode: (code: string) => Promise<void>;
}

export async function handleManualSubmitAction({
  authMode, provider, pasteToken, callbackUrl, authData,
  setStep, setError, onSuccess,
  exchangeTokens, completeXaiManualCode,
}: HandleManualSubmitParams) {
  try {
    setError(null);

    if (authMode === "paste-token" && provider) {
      const { PASTE_TOKEN_PROVIDERS } = await import("./oauthFlowConstants");
      if (PASTE_TOKEN_PROVIDERS[provider]) {
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
}

export function stopProxyForProvider(provider?: string) {
  if (!provider) return;
  const proxyProviders = ["codex", "xai", "trae", "windsurf", "zed"];
  if (proxyProviders.includes(provider)) {
    fetch(`/api/oauth/${provider}/stop-proxy`).catch(() => {});
  }
}

const DEVICE_CODE_PROVIDERS = [
  "github", "kiro", "kimi", "kimi-coding", "kilocode",
  "codebuddy-cn", "codebuddy-intl", "qoder", "grok-cli",
];

interface StartDeviceCodeFlowParams {
  provider: string;
  idcConfig?: { startUrl?: string; region?: string };
  setIsDeviceCode: (v: boolean) => void;
  setStep: SetStep;
  setDeviceData: (d: Record<string, unknown> | null) => void;
  startPolling: (deviceCode: string, codeVerifier: string, interval: number, extraData: Record<string, unknown> | null, deadlineMs?: number) => Promise<void>;
}

export async function startDeviceCodeFlowAction({
  provider, idcConfig,
  setIsDeviceCode, setStep, setDeviceData, startPolling,
}: StartDeviceCodeFlowParams) {
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
    ? { _clientId: data._clientId, _clientSecret: data._clientSecret, _region: data._region, _authMethod: data._authMethod, _startUrl: data._startUrl }
    : provider === "qoder"
    ? { _qoderNonce: data._qoderNonce, _qoderMachineId: data._qoderMachineId, _qoderVerifier: data.codeVerifier }
    : (provider === "kimi" || provider === "kimi-coding")
    ? { _kimiDeviceId: data._kimiDeviceId }
    : null;
  startPolling(
    data.device_code, data.codeVerifier, data.interval || 5, extraData,
    Number.isFinite(data.expires_in) && data.expires_in > 0 ? data.expires_in * 1000 : undefined,
  );
}

interface StartStandardOAuthParams {
  provider: string;
  oauthMeta?: Record<string, string>;
  isLocalhost: boolean;
  setAuthData: (d: Record<string, unknown>) => void;
  setStep: SetStep;
  popupRef: React.MutableRefObject<Window | null>;
}

export async function startStandardOAuthAction({
  provider, oauthMeta, isLocalhost,
  setAuthData, setStep, popupRef,
}: StartStandardOAuthParams) {
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
      throw new Error(`Provider ${provider} uses device-code login but is not wired in the OAuth modal device-code list`);
    }
    throw new Error("No authorization URL returned from OAuth provider");
  }

  if (provider === "codex" && codexProxyActive) {
    setStep("waiting");
    popupRef.current = window.open(data.authUrl, "oauth_popup", "width=600,height=700");
    if (!popupRef.current) setStep("input");
  } else if (provider === "xai" && xaiProxyActive) {
    setStep("waiting");
    popupRef.current = window.open(data.authUrl, "oauth_popup", "width=600,height=700");
    if (!popupRef.current) setStep("input");
  } else if (!isLocalhost || provider === "codex" || provider === "xai") {
    setStep("input");
    window.open(data.authUrl, "_blank");
  } else {
    setStep("waiting");
    popupRef.current = window.open(data.authUrl, "oauth_popup", "width=600,height=700");
    if (!popupRef.current) setStep("input");
  }
}

export function isDeviceCodeProvider(provider: string): boolean {
  return DEVICE_CODE_PROVIDERS.includes(provider);
}

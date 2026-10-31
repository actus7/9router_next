"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { PROXY_OAUTH_PROVIDERS, type ProviderInfo, type UseOAuthFlowProps } from "./oauthFlowConstants";
import { exchangeTokensAction, completeXaiManualCodeAction, startPollingAction, startProxyFlowAction, handleManualSubmitAction, stopProxyForProvider, startDeviceCodeFlowAction, startStandardOAuthAction, isDeviceCodeProvider } from "./oauthFlowActions";
import { useOAuthCallbackListener } from "./useOAuthCallbackListener";
import { useOAuthPolling } from "./useOAuthPolling";

export { PROXY_OAUTH_PROVIDERS };
export type { ProviderInfo };

export function useOAuthFlow({ isOpen, provider, onSuccess, onClose, oauthMeta, idcConfig }: UseOAuthFlowProps) {
  const [step, setStep] = useState<"waiting" | "input" | "success" | "error">("waiting");
  const [authData, setAuthData] = useState<Record<string, unknown> | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isDeviceCode, setIsDeviceCode] = useState(false);
  const [deviceData, setDeviceData] = useState<Record<string, unknown> | null>(null);
  const [polling, setPolling] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const pollingAbortRef = useRef(false);
  const openedRef = useRef(false);
  const { copied, copy } = useCopyToClipboard();
  const [isLocalhost, setIsLocalhost] = useState(false);
  const [placeholderUrl, setPlaceholderUrl] = useState("/callback?code=...");

  useEffect(() => { if (typeof window !== "undefined") { setIsLocalhost(window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"); setPlaceholderUrl(`${window.location.origin}/callback?code=...`); } }, []);

  const exchangeTokens = useCallback(async (code: string, state: string | null) => { await exchangeTokensAction({ code, state, authData, provider, oauthMeta, setStep, setError, onSuccess }); }, [authData, provider, onSuccess, oauthMeta]);
  const completeXaiManualCode = useCallback(async (code: string) => { await completeXaiManualCodeAction({ code, authData, setStep, setError, onSuccess }); }, [authData, onSuccess]);
  const startPolling = useCallback(async (dc: string, cv: string, interval: number, extra: Record<string, unknown> | null, dl?: number) => { await startPollingAction({ deviceCode: dc, codeVerifier: cv, interval, extraData: extra, deadlineMs: dl, provider, pollingAbortRef, setStep, setError, setPolling, onSuccess }); }, [provider, onSuccess]);
  const startProxyFlow = useCallback(async (pid: string) => { await startProxyFlowAction({ providerId: pid, setAuthData, setStep, popupRef }); }, []);

  const startOAuthFlow = useCallback(async () => {
    if (!provider) return;
    try {
      setError(null);
      if (PROXY_OAUTH_PROVIDERS.has(provider)) { await startProxyFlow(provider); return; }
      if (isDeviceCodeProvider(provider)) { await startDeviceCodeFlowAction({ provider, idcConfig, setIsDeviceCode, setStep, setDeviceData, startPolling }); return; }
      await startStandardOAuthAction({ provider, oauthMeta, isLocalhost, setAuthData, setStep, popupRef });
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)); setStep("error"); }
  }, [provider, isLocalhost, startPolling, oauthMeta, idcConfig, startProxyFlow]);

  useEffect(() => {
    if (isOpen && provider) {
      if (openedRef.current) return;
      openedRef.current = true;
      setAuthData(null); setCallbackUrl(""); setError(null); setIsDeviceCode(false); setDeviceData(null); setPolling(false); pollingAbortRef.current = false;
      startOAuthFlow();
    } else if (!isOpen) { pollingAbortRef.current = true; openedRef.current = false; stopProxyForProvider(provider); }
  }, [isOpen, provider, startOAuthFlow]);

  useOAuthPolling(authData, onSuccess, setError, setStep);
  const handleCallbackData = useCallback(async (data: { code?: string; token?: string; state?: string; error?: string; errorDescription?: string }) => {
    if (data.error) { setError(data.errorDescription || data.error); setStep("error"); return; }
    if (data.token || data.code) await exchangeTokens(data.token || data.code!, data.state || null);
  }, [exchangeTokens, setError, setStep]);
  useOAuthCallbackListener(authData, handleCallbackData);

  const handleManualSubmit = async () => { await handleManualSubmitAction({ provider, callbackUrl, authData, setStep, setError, onSuccess, exchangeTokens, completeXaiManualCode }); };
  const handleClose = useCallback(() => { stopProxyForProvider(provider); onClose(); }, [onClose, provider]);

  return { step, setStep, authData, callbackUrl, setCallbackUrl, error, setError, isDeviceCode, deviceData, polling, isLocalhost, placeholderUrl, copied, copy, handleManualSubmit, handleClose, startOAuthFlow };
}

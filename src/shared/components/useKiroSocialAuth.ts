"use client";

import { useState, useEffect, useRef } from "react";

export interface AuthData { authUrl: string; codeVerifier: string; }

export function useKiroSocialAuth(isOpen: boolean, provider: "google" | "github", onSuccess?: () => void) {
  const [step, setStep] = useState<"loading" | "input" | "success" | "error">("loading");
  const [authUrl, setAuthUrl] = useState("");
  const [authData, setAuthData] = useState<AuthData | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const openedRef = useRef(false);

  useEffect(() => { if (!isOpen) openedRef.current = false; }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !provider) return;
    const initAuth = async () => {
      try {
        setError(null); setStep("loading");
        const res = await fetch(`/api/oauth/kiro/social-authorize?provider=${provider}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setAuthData(data); setAuthUrl(data.authUrl); setStep("input");
        if (!openedRef.current) { openedRef.current = true; window.open(data.authUrl, "_blank"); }
      } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)); setStep("error"); }
    };
    initAuth();
  }, [isOpen, provider]);

  const handleManualSubmit = async () => {
    try {
      setError(null);
      const url = new URL(callbackUrl);
      const code = url.searchParams.get("code");
      const errorParam = url.searchParams.get("error");
      if (errorParam) throw new Error(url.searchParams.get("error_description") || errorParam);
      if (!code) throw new Error("No authorization code found in URL");
      const res = await fetch("/api/oauth/kiro/social-exchange", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, codeVerifier: authData?.codeVerifier, provider }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setStep("success"); onSuccess?.();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)); setStep("error"); }
  };

  return { step, authUrl, callbackUrl, setCallbackUrl, error, handleManualSubmit };
}

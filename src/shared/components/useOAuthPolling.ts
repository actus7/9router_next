"use client";

import { useEffect, useRef } from "react";

export function useOAuthPolling(
  authData: Record<string, unknown> | null,
  onSuccess: (() => void) | undefined,
  setError: (e: string) => void,
  setStep: (s: "waiting" | "input" | "success" | "error") => void,
) {
  const callbackProcessedRef = useRef<boolean>(false);
  // Refs for callbacks so the effect never restarts when they change
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const setErrorRef = useRef(setError);
  setErrorRef.current = setError;
  const setStepRef = useRef(setStep);
  setStepRef.current = setStep;
  // Track the timeout for proper cleanup
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derive stable primitive values from authData for the dependency array
  const pollProvider = authData?.codexServerSide
    ? "codex"
    : authData?.xaiServerSide
      ? "xai"
      : authData?.proxyProvider
        ? String(authData.proxyProvider)
        : null;
  const authState = authData?.state ? String(authData.state) : null;

  useEffect(() => {
    if (!pollProvider || !authState) return;
    if (callbackProcessedRef.current) return;
    let cancelled = false;
    const POLL_INTERVAL_MS = 1500;
    const MAX_ATTEMPTS = 200;
    let attempts = 0;

    const tick = async () => {
      if (cancelled || callbackProcessedRef.current) return;
      attempts += 1;
      try {
        const res = await fetch(`/api/oauth/${pollProvider}/poll-status?state=${encodeURIComponent(authState)}`);
        const data = await res.json();
        if (cancelled || callbackProcessedRef.current) return;
        if (data.status === "done") {
          callbackProcessedRef.current = true;
          setStepRef.current("success");
          onSuccessRef.current?.();
          return;
        }
        if (data.status === "error") {
          callbackProcessedRef.current = true;
          setErrorRef.current(data.error || "Authentication failed");
          setStepRef.current("error");
          return;
        }
      } catch { /* Network error, keep polling */ }
      if (attempts >= MAX_ATTEMPTS) {
        callbackProcessedRef.current = true;
        setErrorRef.current("Authentication timeout");
        setStepRef.current("error");
        return;
      }
      timeoutRef.current = setTimeout(tick, POLL_INTERVAL_MS);
    };
    timeoutRef.current = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [pollProvider, authState]);
}

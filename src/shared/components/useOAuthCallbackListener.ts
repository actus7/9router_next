"use client";

import { useEffect, useRef } from "react";

interface CallbackData {
  code?: string;
  token?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

export function useOAuthCallbackListener(
  authData: Record<string, unknown> | null,
  onCallback: (data: CallbackData) => Promise<void>,
) {
  const callbackProcessedRef = useRef<boolean>(false);

  useEffect(() => {
    if (!authData) return;
    callbackProcessedRef.current = false;

    const handleCallback = async (data: CallbackData) => {
      if (callbackProcessedRef.current) return;
      if (data.error) {
        callbackProcessedRef.current = true;
        throw new Error(data.errorDescription || data.error);
      }
      if (data.token || data.code) {
        callbackProcessedRef.current = true;
        await onCallback(data);
      }
    };

    const handleMessage = (event: MessageEvent) => {
      const isLocalhost = event.origin.includes("localhost") || event.origin.includes("127.0.0.1");
      const isSameOrigin = event.origin === window.location.origin;
      if (!isLocalhost && !isSameOrigin) return;
      if (event.data?.type === "oauth_callback") handleCallback(event.data.data);
    };
    window.addEventListener("message", handleMessage);

    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel("oauth_callback");
      channel.onmessage = (event) => handleCallback(event.data);
    } catch { console.error("BroadcastChannel not supported"); }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === "oauth_callback" && event.newValue) {
        try {
          const data = JSON.parse(event.newValue);
          handleCallback(data);
          localStorage.removeItem("oauth_callback");
        } catch { console.error("Failed to parse localStorage data"); }
      }
    };
    window.addEventListener("storage", handleStorage);

    try {
      const stored = localStorage.getItem("oauth_callback");
      if (stored) {
        const data = JSON.parse(stored);
        if (data.timestamp && Date.now() - data.timestamp < 30000) handleCallback(data);
        localStorage.removeItem("oauth_callback");
      }
    } catch { /* ignore */ }

    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("storage", handleStorage);
      if (channel) channel.close();
    };
  }, [authData, onCallback]);
}

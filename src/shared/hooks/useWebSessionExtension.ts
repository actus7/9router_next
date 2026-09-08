"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const CHANNEL = "modelhub-web-session-v1";
export type ExtensionState = "checking" | "missing" | "ready" | "incompatible";
export interface ExtensionReply {
  channel: string;
  direction: string;
  requestId: string;
  type: string;
  version?: string;
  protocol?: number;
  providers?: string[];
  credential?: string;
  error?: string;
}

export function isExtensionReply(event: MessageEvent, requestId: string): event is MessageEvent<ExtensionReply> {
  const data = event.data;
  return event.source === window && event.origin === window.location.origin &&
    data?.channel === CHANNEL && data.direction === "extension" && data.requestId === requestId;
}

export function useWebSessionExtension() {
  const [state, setState] = useState<ExtensionState>("checking");
  const [version, setVersion] = useState("");
  const [providers, setProviders] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detection = useRef<(() => void) | null>(null);
  const capture = useRef<(() => void) | null>(null);

  const detect = useCallback(() => {
    detection.current?.();
    setState("checking");
    const requestId = crypto.randomUUID();
    const cleanup = () => { clearTimeout(timer); window.removeEventListener("message", listener); };
    const listener = (event: MessageEvent) => {
      if (!isExtensionReply(event, requestId) || event.data.type !== "hello") return;
      cleanup();
      const compatible = event.data.protocol === 1;
      setState(compatible ? "ready" : "incompatible");
      setVersion(typeof event.data.version === "string" ? event.data.version : "");
      setProviders(compatible && Array.isArray(event.data.providers) ? event.data.providers.filter((p): p is string => typeof p === "string") : []);
    };
    const timer = setTimeout(() => { cleanup(); setState("missing"); }, 1800);
    detection.current = cleanup;
    window.addEventListener("message", listener);
    window.postMessage({ channel: CHANNEL, direction: "dashboard", type: "hello", requestId }, window.location.origin);
  }, []);

  useEffect(() => {
    detect();
    const onFocus = () => { if (!capture.current) detect(); };
    window.addEventListener("focus", onFocus);
    return () => { detection.current?.(); capture.current?.(); window.removeEventListener("focus", onFocus); };
  }, [detect]);

  const cancel = useCallback(() => { capture.current?.(); setBusy(false); }, []);
  const connect = useCallback((provider: string, onCaptured: (credential: string) => void) => {
    if (state !== "ready" || !providers.includes(provider)) return;
    capture.current?.();
    setError(null);
    setBusy(true);
    const requestId = crypto.randomUUID();
    const send = (type: string) => window.postMessage({ channel: CHANNEL, direction: "dashboard", type, provider, requestId }, window.location.origin);
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("message", listener);
      capture.current = null;
      send("cancel");
    };
    const listener = (event: MessageEvent) => {
      if (!isExtensionReply(event, requestId)) return;
      if (event.data.type === "captured" && typeof event.data.credential === "string" && event.data.credential.length > 0 && event.data.credential.length <= 65536) {
        cleanup(); setBusy(false); onCaptured(event.data.credential);
      } else if (event.data.type === "error") {
        cleanup(); setBusy(false); setError(event.data.error || "Não foi possível capturar a sessão. Tente novamente.");
      }
    };
    const timer = setTimeout(() => {
      cleanup(); setBusy(false); setError("O tempo de conexão terminou. Clique em conectar para tentar novamente.");
    }, 180000);
    capture.current = cleanup;
    window.addEventListener("message", listener);
    send("connect");
  }, [providers, state]);

  return { state, version, providers, busy, error, detect, connect, cancel };
}

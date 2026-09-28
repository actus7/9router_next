"use client";

import { useCallback, useEffect, useState } from "react";
import type { Settings } from "../types";

// Jev is reached through the Vercel AI Gateway, so its credential is simply the
// account's `vercel-ai-gateway` connection. Connecting here goes through the
// same validate-then-create pair the providers page uses; the key lands in
// `providerConnections`, encrypted, and serves the gateway's models too.
const GATEWAY_PROVIDER = "vercel-ai-gateway";

export type JevFeatureKey = "jevSmartRouting" | "jevMemoryReview" | "jevPluginSelection" | "jevWriteRisk" | "jevSynapse";

export type JevTestResult =
  | { ok: true; latencyMs: number }
  | { ok: false; reason: string; status?: number; message: string };

async function patchSettings(updates: Record<string, unknown>): Promise<boolean> {
  const res = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  return res.ok;
}

export function useDecisionEngine(setSettings: (update: (prev: Settings) => Settings) => void) {
  const [hasGatewayKey, setHasGatewayKey] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<JevTestResult | null>(null);

  // One real, billed Jev call. Every feature silently falls back to the
  // heuristic when Jev fails, so this is the only way to see that it does.
  const testJev = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/decisions/jev/test", { method: "POST" });
      setTestResult(res.ok
        ? ((await res.json()) as JevTestResult)
        : { ok: false, reason: "http", status: res.status, message: `HTTP ${res.status}` });
    } catch {
      setTestResult({ ok: false, reason: "http", message: "Could not reach the server." });
    } finally {
      setTesting(false);
    }
  };

  const refreshKeyStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/providers", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { connections?: Array<{ provider?: string; isActive?: boolean }> };
      setHasGatewayKey((data.connections ?? []).some((c) => c.provider === GATEWAY_PROVIDER && c.isActive !== false));
    } catch (err) {
      console.error("Falha ao verificar a conexão da Vercel AI Gateway:", err);
    }
  }, []);

  useEffect(() => {
    void refreshKeyStatus();
  }, [refreshKeyStatus]);

  const update = async (updates: Record<string, unknown>) => {
    try {
      if (await patchSettings(updates)) setSettings((prev) => ({ ...prev, ...updates }));
    } catch (err) {
      console.error("Falha ao atualizar o motor de decisão:", err);
    }
  };

  const connectGatewayKey = async (apiKey: string): Promise<boolean> => {
    const key = apiKey.trim();
    if (!key) return false;
    setConnecting(true);
    setError(null);
    try {
      const validate = await fetch("/api/providers/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: GATEWAY_PROVIDER, apiKey: key }),
      });
      const verdict = (await validate.json().catch(() => ({}))) as { valid?: boolean; error?: string };
      if (!validate.ok || !verdict.valid) {
        setError(verdict.error || "Invalid API key");
        return false;
      }
      const created = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: GATEWAY_PROVIDER, apiKey: key }),
      });
      if (!created.ok) {
        const detail = (await created.json().catch(() => ({}))) as { error?: string };
        setError(detail.error || "Could not save the key");
        return false;
      }
      setHasGatewayKey(true);
      setTestResult(null);
      return true;
    } catch (err) {
      console.error("Falha ao conectar a Vercel AI Gateway:", err);
      setError("Could not save the key");
      return false;
    } finally {
      setConnecting(false);
    }
  };

  return {
    hasGatewayKey,
    connecting,
    error,
    setEngine: (engine: "heuristic" | "jev") => update({ decisionEngine: engine }),
    setFeature: (key: JevFeatureKey, enabled: boolean) => update({ [key]: enabled }),
    connectGatewayKey,
    testing,
    testResult,
    testJev,
  };
}

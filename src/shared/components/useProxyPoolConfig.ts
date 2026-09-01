"use client";

import { useCallback, useEffect, useState } from "react";

const NONE_PROXY_POOL_VALUE = "__none__";

interface ProxyPool { id: string; name: string; }

export function useProxyPoolConfig(providerId: string) {
  const [proxyPools, setProxyPools] = useState<ProxyPool[]>([]);
  const [proxyPoolId, setProxyPoolId] = useState(NONE_PROXY_POOL_VALUE);
  const [rotateStrategy, setRotateStrategy] = useState("none");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/proxy-pools?isActive=true", { cache: "no-store" }).then((r) => r.ok ? r.json() : { proxyPools: [] }),
      fetch("/api/settings", { cache: "no-store" }).then((r) => r.ok ? r.json() : {}),
    ]).then(([poolData, settingsData]: [{ proxyPools?: ProxyPool[] }, { providerStrategies?: Record<string, { proxyPoolId?: string; rotateStrategy?: string }> }]) => {
      if (cancelled) return;
      setProxyPools(poolData.proxyPools || []);
      const override = (settingsData.providerStrategies || {})[providerId] || {};
      setProxyPoolId(override.proxyPoolId || NONE_PROXY_POOL_VALUE);
      setRotateStrategy(override.rotateStrategy || "none");
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [providerId]);

  const save = useCallback(async (poolId: string, strategy: string) => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const data = res.ok ? await res.json() : {};
      const current = data.providerStrategies || {};
      const override: Record<string, unknown> = { ...(current[providerId] || {}) };
      if (poolId === NONE_PROXY_POOL_VALUE) delete override.proxyPoolId; else override.proxyPoolId = poolId;
      if (strategy === "none") delete override.rotateStrategy; else override.rotateStrategy = strategy;
      const updated = { ...current };
      if (Object.keys(override).length === 0) delete updated[providerId]; else updated[providerId] = override;
      await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerStrategies: updated }) });
      setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1500);
    } catch (e) { console.error("Save proxy config error:", e);
    } finally { setSaving(false); }
  }, [providerId]);

  const handlePoolChange = (v: string) => { setProxyPoolId(v); save(v, rotateStrategy); };
  const handleStrategyChange = (v: string) => { setRotateStrategy(v); save(proxyPoolId, v); };

  return { proxyPools, proxyPoolId, rotateStrategy, saving, savedFlash, handlePoolChange, handleStrategyChange };
}

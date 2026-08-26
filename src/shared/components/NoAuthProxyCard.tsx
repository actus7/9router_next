"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Unlock } from "lucide-react";

const NONE_PROXY_POOL_VALUE = "__none__";
const STRATEGIES = [
  { value: "none", label: "None (single pool)" },
  { value: "round-robin", label: "Round-robin" },
  { value: "random", label: "Random" },
];

interface ProxyPool {
  id: string;
  name: string;
}

interface NoAuthProxyCardProps {
  providerId: string;
}

export default function NoAuthProxyCard({ providerId }: NoAuthProxyCardProps) {
  const [proxyPools, setProxyPools] = useState<ProxyPool[]>([]);
  const [proxyPoolId, setProxyPoolId] = useState<string>(NONE_PROXY_POOL_VALUE);
  const [rotateStrategy, setRotateStrategy] = useState<string>("none");
  const [saving, setSaving] = useState<boolean>(false);
  const [savedFlash, setSavedFlash] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/proxy-pools?isActive=true", { cache: "no-store" }).then((r) => r.ok ? r.json() : { proxyPools: [] }),
      fetch("/api/settings", { cache: "no-store" }).then((r) => r.ok ? r.json() : {}),
    ]).then(([poolData, settingsData]: [any, any]) => {
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
      if (poolId === NONE_PROXY_POOL_VALUE) delete override.proxyPoolId;
      else override.proxyPoolId = poolId;
      if (strategy === "none") delete override.rotateStrategy;
      else override.rotateStrategy = strategy;
      const updated = { ...current };
      if (Object.keys(override).length === 0) delete updated[providerId];
      else updated[providerId] = override;
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerStrategies: updated }),
      });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (e) {
      console.log("Save proxy config error:", e);
    } finally {
      setSaving(false);
    }
  }, [providerId]);

  const handlePoolChange = (newPoolId: string) => {
    setProxyPoolId(newPoolId);
    save(newPoolId, rotateStrategy);
  };

  const handleStrategyChange = (newStrategy: string) => {
    setRotateStrategy(newStrategy);
    save(proxyPoolId, newStrategy);
  };

  const canRotate = proxyPools.length >= 2;
  const isRotation = rotateStrategy !== "none";

  return (
    <Card>
      <CardContent>
        <div className="flex items-center gap-3 mb-4">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-green-500/10 text-green-500">
            <Unlock className="size-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">No authentication required</p>
            <p className="text-xs text-text-muted">This provider is ready to use. Optionally route requests through a proxy pool to bypass IP-based limits.</p>
          </div>
          {savedFlash && <Badge variant="default" className="h-auto px-2 py-0.5 text-[10px] bg-green-500/10 text-green-600 dark:text-green-400">Saved</Badge>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-text-main">Proxy Pool</Label>
          <Select
            value={proxyPoolId}
            onValueChange={(val) => handlePoolChange(val ?? NONE_PROXY_POOL_VALUE)}
            disabled={saving || isRotation}
            items={[{ value: NONE_PROXY_POOL_VALUE, label: "None (direct)" }, ...proxyPools.map((pool) => ({ value: pool.id, label: pool.name }))]}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a pool" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_PROXY_POOL_VALUE}>None (direct)</SelectItem>
              {proxyPools.map((pool) => (
                <SelectItem key={pool.id} value={pool.id}>{pool.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isRotation && <p className="text-xs text-text-muted">Pool selector is ignored when rotation is active — all active pools are used.</p>}
        </div>

        <div className="flex flex-col gap-2 mt-4">
          <Label className="text-text-main">Rotation Strategy</Label>
          <Select value={rotateStrategy} onValueChange={handleStrategyChange} disabled={saving}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select strategy" />
            </SelectTrigger>
            <SelectContent>
              {STRATEGIES.map((s) => (
                <SelectItem key={s.value} value={s.value} disabled={s.value !== "none" && !canRotate}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-text-muted">
            {!canRotate
              ? `Need at least 2 active proxy pools for rotation.`
              : isRotation
                ? rotateStrategy === "round-robin"
                  ? `Rotating through all ${proxyPools.length} active pools in order. State is in-memory (resets on restart).`
                  : `Picking a random pool from ${proxyPools.length} active pools each request.`
                : `Uses the selected pool above. Set to Round-robin or Random to rotate across all active pools.`}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

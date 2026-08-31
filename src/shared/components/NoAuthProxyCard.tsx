"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ChevronDown, Route, Unlock } from "lucide-react";
import { translate } from "@/i18n/runtime";

const NONE_PROXY_POOL_VALUE = "__none__";
const STRATEGIES = [
  { value: "none", label: translate("None (single pool)") ?? "None (single pool)" },
  { value: "round-robin", label: "Round-robin" },
  { value: "random", label: translate("Random") ?? "Random" },
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
    } catch (error) { console.error("Save proxy config error:", error);
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
    <Card className="rounded-xl border-border-subtle bg-surface shadow-[var(--shadow-soft)]">
      <CardContent className="py-3 sm:py-4">
        <Alert className="mb-3 border-border-subtle bg-transparent px-3 py-2">
          <Unlock />
          <AlertTitle className="flex items-center gap-2">
            {translate("No authentication required")}
            {savedFlash && <Badge variant="secondary">{translate("Saved")}</Badge>}
          </AlertTitle>
          <AlertDescription>{translate("This provider is ready for use. Optionally, route requests through a proxy pool to bypass IP-based limits.")}</AlertDescription>
        </Alert>

        <Collapsible>
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm font-medium text-text-main transition-colors hover:bg-muted/50">
            <span className="flex items-center gap-2"><Route className="size-4 text-text-muted" />{translate("Routing options")}</span>
            <ChevronDown className="size-4 text-text-muted" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 border-t border-border-subtle pt-3">
        <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label className="text-text-main">{translate("Proxy Pool")}</Label>
          <Select
            value={proxyPoolId}
            onValueChange={(val) => handlePoolChange(val ?? NONE_PROXY_POOL_VALUE)}
            disabled={saving || isRotation}
            items={[{ value: NONE_PROXY_POOL_VALUE, label: translate("None (direct)") ?? "None (direct)" }, ...proxyPools.map((pool) => ({ value: pool.id, label: pool.name }))]}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={translate("Select a pool") ?? "Select a pool"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_PROXY_POOL_VALUE}>{translate("None (direct)") ?? "None (direct)"}</SelectItem>
              {proxyPools.map((pool) => (
                <SelectItem key={pool.id} value={pool.id}>{pool.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isRotation && <p className="text-xs text-text-muted">{translate("The pool selector is ignored when rotation is active — all active pools are used.")}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-text-main">{translate("Rotation Strategy")}</Label>
          <ToggleGroup
            value={[rotateStrategy]}
            onValueChange={(values) => values[0] && handleStrategyChange(values[0])}
            disabled={saving}
            size="sm"
            spacing={0}
            variant="outline"
          >
            {STRATEGIES.map((strategy) => (
              <ToggleGroupItem key={strategy.value} value={strategy.value} disabled={strategy.value !== "none" && !canRotate}>
                {strategy.value === "none" ? translate("Direct") : strategy.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-xs text-text-muted">
            {!canRotate
              ? translate("At least 2 active proxy pools required for rotation.")
              : isRotation
                ? rotateStrategy === "round-robin"
                  ? translate("Rotating among all") + " " + proxyPools.length + " " + translate("active pools in order. State is in-memory (resets on restart).")
                  : translate("Selecting a random pool among") + " " + proxyPools.length + " " + translate("active pools per request.")
                : translate("Uses the selected pool above. Set to Round-robin or Random to rotate among all active pools.")}
          </p>
        </div>
        </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

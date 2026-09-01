"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ChevronDown, Route, Unlock } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { useProxyPoolConfig } from "./useProxyPoolConfig";

const NONE_PROXY_POOL_VALUE = "__none__";
const STRATEGIES = [
  { value: "none", label: translate("None (single pool)") ?? "None (single pool)" },
  { value: "round-robin", label: "Round-robin" },
  { value: "random", label: translate("Random") ?? "Random" },
];

interface NoAuthProxyCardProps { providerId: string; }

export default function NoAuthProxyCard({ providerId }: NoAuthProxyCardProps) {
  const { proxyPools, proxyPoolId, rotateStrategy, saving, savedFlash, handlePoolChange, handleStrategyChange } = useProxyPoolConfig(providerId);
  const canRotate = proxyPools.length >= 2;
  const isRotation = rotateStrategy !== "none";

  return (
    <Card className="rounded-xl border-border-subtle bg-surface shadow-[var(--shadow-soft)]">
      <CardContent className="py-3 sm:py-4">
        <Alert className="mb-3 border-border-subtle bg-transparent px-3 py-2">
          <Unlock />
          <AlertTitle className="flex items-center gap-2">{translate("No authentication required")}{savedFlash && <Badge variant="secondary">{translate("Saved")}</Badge>}</AlertTitle>
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
                <Select value={proxyPoolId} onValueChange={(val) => handlePoolChange(val ?? NONE_PROXY_POOL_VALUE)} disabled={saving || isRotation} items={[{ value: NONE_PROXY_POOL_VALUE, label: translate("None (direct)") ?? "None (direct)" }, ...proxyPools.map((p) => ({ value: p.id, label: p.name }))]}>
                  <SelectTrigger className="w-full"><SelectValue placeholder={translate("Select a pool") ?? "Select a pool"} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_PROXY_POOL_VALUE}>{translate("None (direct)") ?? "None (direct)"}</SelectItem>
                    {proxyPools.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {isRotation && <p className="text-xs text-text-muted">{translate("The pool selector is ignored when rotation is active — all active pools are used.")}</p>}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-text-main">{translate("Rotation Strategy")}</Label>
                <ToggleGroup value={[rotateStrategy]} onValueChange={(v) => v[0] && handleStrategyChange(v[0])} disabled={saving} size="sm" spacing={0} variant="outline">
                  {STRATEGIES.map((s) => <ToggleGroupItem key={s.value} value={s.value} disabled={s.value !== "none" && !canRotate}>{s.value === "none" ? translate("Direct") : s.label}</ToggleGroupItem>)}
                </ToggleGroup>
                <p className="text-xs text-text-muted">{!canRotate ? translate("At least 2 active proxy pools required for rotation.") : isRotation ? rotateStrategy === "round-robin" ? translate("Rotating among all") + " " + proxyPools.length + " " + translate("active pools in order. State is in-memory (resets on restart).") : translate("Selecting a random pool among") + " " + proxyPools.length + " " + translate("active pools per request.") : translate("Uses the selected pool above. Set to Round-robin or Random to rotate among all active pools.")}</p>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

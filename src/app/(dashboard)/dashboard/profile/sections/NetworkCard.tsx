"use client";

import { Card, Button, Input } from "@/shared/components";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Wifi } from "lucide-react";
import { translate } from "@/i18n/runtime";
import type { Settings, StatusMessage } from "../types";

interface NetworkCardProps {
  settings: Settings;
  loading: boolean;
  proxyForm: { outboundProxyEnabled: boolean; outboundProxyUrl: string; outboundNoProxy: string };
  setProxyForm: React.Dispatch<React.SetStateAction<{ outboundProxyEnabled: boolean; outboundProxyUrl: string; outboundNoProxy: string }>>;
  proxyStatus: StatusMessage;
  proxyLoading: boolean;
  proxyTestLoading: boolean;
  updateOutboundProxy: (e: React.FormEvent) => Promise<void>;
  testOutboundProxy: () => Promise<void>;
  updateOutboundProxyEnabled: (enabled: boolean) => Promise<void>;
}

export default function NetworkCard({
  settings, loading,
  proxyForm, setProxyForm, proxyStatus, proxyLoading, proxyTestLoading,
  updateOutboundProxy, testOutboundProxy, updateOutboundProxyEnabled,
}: NetworkCardProps) {
  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500 shrink-0">
          <Wifi className="size-5" />
        </div>
        <h3 className="text-base sm:text-lg font-semibold">{translate("Network")}</h3>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-start sm:items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm sm:text-base">{translate("Outbound Proxy")}</p>
            <p className="text-xs sm:text-sm text-text-muted">{translate("Enable proxy for OAuth + provider outbound requests.")}</p>
          </div>
          <Switch
            checked={settings.outboundProxyEnabled === true}
            onCheckedChange={() => updateOutboundProxyEnabled(!(settings.outboundProxyEnabled === true))}
            disabled={loading || proxyLoading}
          />
        </div>

        {settings.outboundProxyEnabled === true && (
          <form onSubmit={updateOutboundProxy} className="flex flex-col gap-4 pt-2 border-t border-border/50">
            <div className="flex flex-col gap-2">
              <Label className="sm:text-base">{translate("Proxy URL")}</Label>
              <Input
                placeholder="http://127.0.0.1:7897"
                value={proxyForm.outboundProxyUrl}
                onChange={(e) => setProxyForm((prev) => ({ ...prev, outboundProxyUrl: e.target.value }))}
                disabled={loading || proxyLoading}
              />
              <p className="text-xs sm:text-sm text-text-muted">{translate("Leave empty to inherit existing env proxy (if any).")}</p>
            </div>

            <div className="flex flex-col gap-2 pt-2 border-t border-border/50">
              <Label className="sm:text-base">{translate("No Proxy")}</Label>
              <Input
                placeholder="localhost,127.0.0.1"
                value={proxyForm.outboundNoProxy}
                onChange={(e) => setProxyForm((prev) => ({ ...prev, outboundNoProxy: e.target.value }))}
                disabled={loading || proxyLoading}
              />
              <p className="text-xs sm:text-sm text-text-muted">{translate("Comma-separated hostnames/domains to bypass the proxy.")}</p>
            </div>

            <div className="pt-2 border-t border-border/50 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                loading={proxyTestLoading}
                disabled={loading || proxyLoading}
                onClick={testOutboundProxy}
                className="w-full sm:w-auto"
              >
                {translate("Test proxy URL")}
              </Button>
              <Button type="submit" variant="primary" loading={proxyLoading} className="w-full sm:w-auto">
                {translate("Apply")}
              </Button>
            </div>
          </form>
        )}

        {proxyStatus.message && (
          <p className={`text-xs sm:text-sm ${proxyStatus.type === "error" ? "text-red-500" : "text-green-500"} pt-2 border-t border-border/50`}>
            {proxyStatus.message}
          </p>
        )}
      </div>
    </Card>
  );
}

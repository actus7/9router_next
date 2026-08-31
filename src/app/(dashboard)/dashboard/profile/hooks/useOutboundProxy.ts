"use client";

import { useState } from "react";
import { translate } from "@/i18n/runtime";
import type { Settings, StatusMessage } from "../types";

export function useOutboundProxy(initialSettings: Settings, settings: Settings, setSettings: React.Dispatch<React.SetStateAction<Settings>>) {
  const [proxyForm, setProxyForm] = useState({
    outboundProxyEnabled: initialSettings?.outboundProxyEnabled === true,
    outboundProxyUrl: (initialSettings?.outboundProxyUrl as string) || "",
    outboundNoProxy: (initialSettings?.outboundNoProxy as string) || "",
  });
  const [proxyStatus, setProxyStatus] = useState<StatusMessage>({ type: "", message: "" });
  const [proxyLoading, setProxyLoading] = useState(false);
  const [proxyTestLoading, setProxyTestLoading] = useState(false);

  const updateOutboundProxy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (settings.outboundProxyEnabled !== true) return;
    setProxyLoading(true);
    setProxyStatus({ type: "", message: "" });

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outboundProxyUrl: proxyForm.outboundProxyUrl,
          outboundNoProxy: proxyForm.outboundNoProxy,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setSettings((prev) => ({ ...prev, ...data }));
        setProxyStatus({ type: "success", message: translate("Proxy settings applied") || "Proxy settings applied" });
      } else {
        setProxyStatus({ type: "error", message: data.error || translate("Failed to update proxy settings") || "Failed to update proxy settings" });
      }
    } catch (err) {
      setProxyStatus({ type: "error", message: translate("An error occurred") || "An error occurred" });
    } finally {
      setProxyLoading(false);
    }
  };

  const testOutboundProxy = async () => {
    if (settings.outboundProxyEnabled !== true) return;

    const proxyUrl = (proxyForm.outboundProxyUrl || "").trim();
    if (!proxyUrl) {
      setProxyStatus({ type: "error", message: translate("Please enter a Proxy URL to test") || "Please enter a Proxy URL to test" });
      return;
    }

    setProxyTestLoading(true);
    setProxyStatus({ type: "", message: "" });

    try {
      const res = await fetch("/api/settings/proxy-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxyUrl }),
      });

      const data = await res.json();
      if (res.ok && data?.ok) {
        setProxyStatus({
          type: "success",
          message: `${translate("Proxy test OK") || "Proxy test OK"} (${data.status}) ${translate("in") || "in"} ${data.elapsedMs}ms`,
        });
      } else {
        setProxyStatus({
          type: "error",
          message: data?.error || translate("Proxy test failed") || "Proxy test failed",
        });
      }
    } catch (err) {
      setProxyStatus({ type: "error", message: translate("An error occurred") || "An error occurred" });
    } finally {
      setProxyTestLoading(false);
    }
  };

  const updateOutboundProxyEnabled = async (outboundProxyEnabled: boolean) => {
    setProxyLoading(true);
    setProxyStatus({ type: "", message: "" });

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outboundProxyEnabled }),
      });

      const data = await res.json();
      if (res.ok) {
        setSettings((prev) => ({ ...prev, ...data }));
        setProxyForm((prev) => ({ ...prev, outboundProxyEnabled: data?.outboundProxyEnabled === true }));
        setProxyStatus({
          type: "success",
          message: outboundProxyEnabled ? translate("Proxy enabled") || "Proxy enabled" : translate("Proxy disabled") || "Proxy disabled",
        });
      } else {
        setProxyStatus({ type: "error", message: data.error || translate("Failed to update proxy settings") || "Failed to update proxy settings" });
      }
    } catch (err) {
      setProxyStatus({ type: "error", message: translate("An error occurred") || "An error occurred" });
    } finally {
      setProxyLoading(false);
    }
  };

  return {
    proxyForm, setProxyForm,
    proxyStatus, setProxyStatus,
    proxyLoading, setProxyLoading,
    proxyTestLoading, setProxyTestLoading,
    updateOutboundProxy, testOutboundProxy, updateOutboundProxyEnabled,
  };
}

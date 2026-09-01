"use client";

import { useState, useEffect } from "react";
import { AI_PROVIDERS, isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";

interface Connection {
  id: string; name?: string; email?: string; priority?: number;
  authType?: string; provider?: string; providerSpecificData?: Record<string, unknown>;
}
interface ProviderRegion { id: string; label: string; }

export function useEditConnectionForm(connection: Connection | null) {
  const [formData, setFormData] = useState({ name: "", priority: 1, apiKey: "" });
  const [azureData, setAzureData] = useState({ azureEndpoint: "", apiVersion: "2024-10-01-preview", deployment: "", organization: "" });
  const [cloudflareData, setCloudflareData] = useState({ accountId: "" });
  const [region, setRegion] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!connection) return;
    setFormData({ name: connection.name || "", priority: connection.priority || 1, apiKey: "" });
    if (connection.provider === "azure" && connection.providerSpecificData) {
      const psd = connection.providerSpecificData;
      setAzureData({ azureEndpoint: (psd.azureEndpoint as string) || "", apiVersion: (psd.apiVersion as string) || "2024-10-01-preview", deployment: (psd.deployment as string) || "", organization: (psd.organization as string) || "" });
    }
    if (connection.provider === "cloudflare-ai" && connection.providerSpecificData) {
      setCloudflareData({ accountId: (connection.providerSpecificData.accountId as string) || "" });
    }
    const providerCfg = AI_PROVIDERS?.[connection.provider as keyof typeof AI_PROVIDERS] as Record<string, unknown> | undefined;
    if (providerCfg?.regions) {
      const regions = providerCfg.regions as ProviderRegion[];
      setRegion((connection.providerSpecificData?.region as string) || (providerCfg.defaultRegion as string) || regions[0]?.id || "");
    }
    setTestResult(null); setValidationResult(null);
  }, [connection]);

  const isOAuth = connection?.authType === "oauth";
  const isAzure = connection?.provider === "azure";
  const isCloudflareAi = connection?.provider === "cloudflare-ai";
  const isCompatible = connection ? (isOpenAICompatibleProvider(connection.provider ?? "") || isAnthropicCompatibleProvider(connection.provider ?? "")) : false;
  const providerRegions: ProviderRegion[] | null = connection ? ((AI_PROVIDERS?.[connection.provider as keyof typeof AI_PROVIDERS] as Record<string, unknown>)?.regions as ProviderRegion[] || null) : null;

  const buildRegionSpecificData = (): Record<string, unknown> | undefined => {
    if (providerRegions && region) return { ...((connection?.providerSpecificData) || {}), region };
    return undefined;
  };

  return {
    formData, setFormData, azureData, setAzureData, cloudflareData, setCloudflareData,
    region, setRegion, testing, setTesting, testResult, setTestResult,
    validating, setValidating, validationResult, setValidationResult, saving, setSaving,
    isOAuth, isAzure, isCloudflareAi, isCompatible, providerRegions, buildRegionSpecificData,
  };
}

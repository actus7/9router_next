"use client";

import { useState } from "react";
import { Modal } from "@/shared/components";
import { Button } from "@/shared/components";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import BulkAddForm from "./components/BulkAddForm";
import SingleAddForm from "./components/SingleAddForm";

const BULK_PLACEHOLDER = `name1|sk-key1\nname2|sk-key2\nsk-key-only-auto-named`;

interface ProxyPool {
  id: string;
  name: string;
}

interface AddApiKeyModalProps {
  isOpen: boolean;
  provider?: string;
  providerName?: string;
  isCompatible?: boolean;
  isAnthropic?: boolean;
  authType?: string;
  authHint?: string;
  website?: string;
  proxyPools?: ProxyPool[];
  error?: string;
  existingNames?: string[];
  onSave: (formData: Record<string, unknown>) => Promise<void>;
  onBulkDone?: () => void;
  onClose: () => void;
}

export default function AddApiKeyModal({ isOpen, provider, providerName, isCompatible, isAnthropic, authType, authHint, website, proxyPools, error, existingNames, onSave, onBulkDone, onClose }: AddApiKeyModalProps) {
  const NONE_PROXY_POOL_VALUE = "__none__";
  const isCookie = authType === "cookie";
  const isXaiApiKey = provider === "xai" && !isCookie;
  const credentialLabel = isCookie ? "Cookie Value" : provider === "qoder" ? "Personal Access Token (PAT)" : "API Key";
  const credentialPlaceholder = isCookie ? "eyJhbGciOi..." : (isXaiApiKey ? "xai-..." : provider === "qoder" ? "pt-..." : "");

  const isAzure = provider === "azure";
  const isCloudflareAi = provider === "cloudflare-ai";
  const providerInfo = provider ? AI_PROVIDERS[provider] : undefined;
  const providerRegions = (providerInfo?.regions as { id: string; label: string }[] | undefined) || null;
  const defaultRegion = (providerInfo?.defaultRegion as string | undefined) || providerRegions?.[0]?.id || "";

  const [formData, setFormData] = useState({ name: "", apiKey: "", defaultModel: "", priority: 1, proxyPoolId: NONE_PROXY_POOL_VALUE });
  const [azureData, setAzureData] = useState({ azureEndpoint: "", apiVersion: "2024-10-01-preview", deployment: "", organization: "" });
  const [cloudflareData, setCloudflareData] = useState({ accountId: "" });
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState("https://ollama.com");
  const [region, setRegion] = useState<string>(defaultRegion);
  const [validating, setValidating] = useState<boolean>(false);
  const [validationResult, setValidationResult] = useState<"success" | "failed" | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const bulkPlaceholder = isCloudflareAi ? `name1|sk-key1|acc123456\nname2|sk-key2|def789012\nsk-key-only-auto-named` : provider === "qoder" ? `name1|pt-xxxxx\nname2|pt-yyyyy\npt-only-auto-named` : BULK_PLACEHOLDER;
  const [mode, setMode] = useState<"single" | "bulk">("single");

  const buildProviderSpecificData = (): Record<string, string> | undefined => {
    if (isAzure) return { azureEndpoint: azureData.azureEndpoint, apiVersion: azureData.apiVersion, deployment: azureData.deployment, organization: azureData.organization };
    if (isCloudflareAi) return { accountId: cloudflareData.accountId };
    if (provider === "ollama") return { baseUrl: ollamaBaseUrl.trim().replace(/\/$/, "") || "https://ollama.com" };
    if (providerRegions && region) return { region };
    return undefined;
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch("/api/providers/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, apiKey: formData.apiKey, providerSpecificData: buildProviderSpecificData() }) });
      const data = await res.json();
      setValidationResult(data.valid ? "success" : "failed");
    } catch { setValidationResult("failed"); } finally { setValidating(false); }
  };

  const handleSubmit = async () => {
    if (!provider || !formData.apiKey || !formData.name || (isCompatible && !formData.defaultModel.trim())) return;
    setSaving(true);
    try {
      let isValid = false;
      try {
        setValidating(true); setValidationResult(null);
        const res = await fetch("/api/providers/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, apiKey: formData.apiKey, providerSpecificData: buildProviderSpecificData() }) });
        const data = await res.json(); isValid = !!data.valid; setValidationResult(isValid ? "success" : "failed");
      } catch { setValidationResult("failed"); } finally { setValidating(false); }
      await onSave({ name: formData.name, apiKey: formData.apiKey, defaultModel: isCompatible ? formData.defaultModel.trim() : undefined, priority: formData.priority, proxyPoolId: formData.proxyPoolId === NONE_PROXY_POOL_VALUE ? null : formData.proxyPoolId, testStatus: isValid ? "active" : "unknown", providerSpecificData: buildProviderSpecificData() });
    } finally { setSaving(false); }
  };

  if (!provider) return null;

  return (
    <Modal isOpen={isOpen} title={`Add ${providerName || provider} ${credentialLabel}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Button variant={mode === "single" ? "primary" : "ghost"} onClick={() => setMode("single")}>Single</Button>
          <Button variant={mode === "bulk" ? "primary" : "ghost"} onClick={() => setMode("bulk")}>Bulk Add</Button>
        </div>
        {mode === "bulk" && (
          <BulkAddForm provider={provider} isCloudflareAi={isCloudflareAi} bulkPlaceholder={bulkPlaceholder} existingNames={existingNames} onBulkDone={onBulkDone} onClose={onClose} />
        )}
        {mode === "single" && (
          <SingleAddForm
            provider={provider} isCompatible={isCompatible ?? false} isAnthropic={isAnthropic} isCookie={isCookie} isXaiApiKey={isXaiApiKey}
            credentialLabel={credentialLabel} credentialPlaceholder={credentialPlaceholder} authHint={authHint} website={website}
            isAzure={isAzure} isCloudflareAi={isCloudflareAi}
            formData={formData} setFormData={setFormData}
            azureData={azureData} setAzureData={setAzureData}
            cloudflareData={cloudflareData} setCloudflareData={setCloudflareData}
            ollamaBaseUrl={ollamaBaseUrl} setOllamaBaseUrl={setOllamaBaseUrl}
            providerRegions={providerRegions} region={region} setRegion={setRegion}
            validationResult={validationResult} error={error}
            validating={validating} saving={saving}
            proxyPools={proxyPools} noneProxyPoolValue={NONE_PROXY_POOL_VALUE}
            onValidate={handleValidate} onSubmit={handleSubmit} onClose={onClose}
          />
        )}
      </div>
    </Modal>
  );
}

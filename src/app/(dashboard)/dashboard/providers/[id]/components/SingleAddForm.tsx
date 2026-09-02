"use client";

import { Badge } from "@/components/ui/badge";
import ProviderSpecificFields from "./ProviderSpecificFields";
import CredentialInputs from "./CredentialInputs";
import FormFooter from "./FormFooter";

interface SingleAddFormProps {
  provider: string;
  isCompatible: boolean;
  isAnthropic?: boolean;
  isCookie: boolean;
  isXaiApiKey: boolean;
  credentialLabel: string;
  credentialPlaceholder: string;
  authHint?: string;
  website?: string;
  isAzure: boolean;
  isCloudflareAi: boolean;
  formData: { name: string; apiKey: string; defaultModel: string; priority: number; proxyPoolId: string };
  setFormData: React.Dispatch<React.SetStateAction<{ name: string; apiKey: string; defaultModel: string; priority: number; proxyPoolId: string }>>;
  azureData: { azureEndpoint: string; apiVersion: string; deployment: string; organization: string };
  setAzureData: React.Dispatch<React.SetStateAction<{ azureEndpoint: string; apiVersion: string; deployment: string; organization: string }>>;
  cloudflareData: { accountId: string };
  setCloudflareData: React.Dispatch<React.SetStateAction<{ accountId: string }>>;
  ollamaBaseUrl: string;
  setOllamaBaseUrl: React.Dispatch<React.SetStateAction<string>>;
  providerRegions: { id: string; label: string }[] | null;
  region: string;
  setRegion: React.Dispatch<React.SetStateAction<string>>;
  validationResult: "success" | "failed" | null;
  error?: string;
  validating: boolean;
  saving: boolean;
  proxyPools?: Array<{ id: string; name: string }>;
  noneProxyPoolValue: string;
  onValidate: () => void;
  onSubmit: () => void;
  onClose: () => void;
}

export default function SingleAddForm({
  provider, isCompatible, isAnthropic, isCookie, isXaiApiKey, credentialLabel, credentialPlaceholder,
  authHint, website, isAzure, isCloudflareAi, formData, setFormData, azureData, setAzureData,
  cloudflareData, setCloudflareData, ollamaBaseUrl, setOllamaBaseUrl, providerRegions, region, setRegion,
  validationResult, error, validating, saving, proxyPools, noneProxyPoolValue, onValidate, onSubmit, onClose,
}: SingleAddFormProps) {
  const canSubmit = !!formData.name && !!formData.apiKey && (!isCompatible || !!formData.defaultModel.trim()) && (!isAzure || (!!azureData.azureEndpoint && !!azureData.deployment && !!azureData.organization)) && (!isCloudflareAi || !!cloudflareData.accountId);

  return (
    <>
      <CredentialInputs name={formData.name} apiKey={formData.apiKey} credentialLabel={credentialLabel} credentialPlaceholder={credentialPlaceholder} isCookie={isCookie} validating={validating} saving={saving} onNameChange={(name) => setFormData({ ...formData, name })} onApiKeyChange={(apiKey) => setFormData({ ...formData, apiKey })} onValidate={onValidate} />
      {isXaiApiKey && <p className="text-xs text-text-muted">Use a direct xAI API key from console.x.ai. This is separate from Grok Build OAuth.</p>}
      {isCookie && authHint && (
        <p className="text-xs text-text-muted">
          {authHint}
          {website && <><br /><a href={website} target="_blank" rel="noopener noreferrer" className="text-primary underline">Open {website.replace(/^https?:\/\//, "")}</a></>}
        </p>
      )}
      <ProviderSpecificFields provider={provider} isAzure={isAzure} isCloudflareAi={isCloudflareAi} azureData={azureData} setAzureData={setAzureData} cloudflareData={cloudflareData} setCloudflareData={setCloudflareData} ollamaBaseUrl={ollamaBaseUrl} setOllamaBaseUrl={setOllamaBaseUrl} providerRegions={providerRegions} region={region} setRegion={setRegion} />
      {validationResult && <Badge variant={validationResult === "success" ? "success" : "destructive"}>{validationResult === "success" ? "Valid" : "Invalid"}</Badge>}
      {error && <p className="text-xs text-destructive-foreground break-words">{error}</p>}
      <FormFooter isCompatible={isCompatible} isAzure={isAzure} isCloudflareAi={isCloudflareAi} defaultModel={formData.defaultModel} onDefaultModelChange={(defaultModel) => setFormData({ ...formData, defaultModel })} isAnthropic={isAnthropic} priority={formData.priority} onPriorityChange={(priority) => setFormData({ ...formData, priority })} proxyPoolId={formData.proxyPoolId} onProxyPoolChange={(proxyPoolId) => setFormData({ ...formData, proxyPoolId })} proxyPools={proxyPools} noneProxyPoolValue={noneProxyPoolValue} saving={saving} canSubmit={canSubmit} onSubmit={onSubmit} onClose={onClose} />
    </>
  );
}

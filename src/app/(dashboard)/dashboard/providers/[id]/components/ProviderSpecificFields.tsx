"use client";

import { FormInput as Input } from "@/components/ui/form-input";
import { Select } from "@/shared/components";

interface ProviderSpecificFieldsProps {
  provider?: string;
  isAzure: boolean;
  isCloudflareAi: boolean;
  azureData: {
    azureEndpoint: string;
    apiVersion: string;
    deployment: string;
    organization: string;
  };
  setAzureData: React.Dispatch<React.SetStateAction<{
    azureEndpoint: string;
    apiVersion: string;
    deployment: string;
    organization: string;
  }>>;
  cloudflareData: { accountId: string };
  setCloudflareData: React.Dispatch<React.SetStateAction<{ accountId: string }>>;
  ollamaBaseUrl: string;
  setOllamaBaseUrl: React.Dispatch<React.SetStateAction<string>>;
  providerRegions: { id: string; label: string }[] | null;
  region: string;
  setRegion: React.Dispatch<React.SetStateAction<string>>;
}

export default function ProviderSpecificFields({
  provider,
  isAzure,
  isCloudflareAi,
  azureData,
  setAzureData,
  cloudflareData,
  setCloudflareData,
  ollamaBaseUrl,
  setOllamaBaseUrl,
  providerRegions,
  region,
  setRegion,
}: ProviderSpecificFieldsProps) {
  return (
    <>
      {providerRegions && (
        <Select
          label="Region"
          value={region}
          onChange={(value: string) => setRegion(value)}
          options={providerRegions.map((r: { id: string; label: string }) => ({ value: r.id, label: r.label }))}
        />
      )}
      {isCloudflareAi && (
        <div className="bg-sidebar/50 p-4 rounded-lg border border-accent/20">
          <h3 className="font-semibold mb-3 text-sm">Cloudflare Workers AI</h3>
          <Input
            label="Account ID"
            value={cloudflareData.accountId}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCloudflareData({ ...cloudflareData, accountId: e.target.value })}
            placeholder="abc123def456..."
          />
          <p className="text-xs text-text-muted mt-2">
            Find your Account ID in the right sidebar of <a href="https://dash.cloudflare.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">dash.cloudflare.com</a>
          </p>
        </div>
      )}
      {provider === "ollama" && (
        <div className="bg-sidebar/50 p-4 rounded-lg border border-accent/20">
          <h3 className="font-semibold mb-3 text-sm">Ollama endpoint</h3>
          <Input
            label="Base URL"
            value={ollamaBaseUrl}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setOllamaBaseUrl(e.target.value)}
            placeholder="https://ollama.com or http://127.0.0.1:11434"
          />
          <p className="text-xs text-text-muted mt-2">
            Use https://ollama.com for Cloud, or the URL reachable by this server for a self-hosted Ollama daemon.
          </p>
        </div>
      )}
      {isAzure && (
        <div className="bg-sidebar/50 p-4 rounded-lg border border-accent/20">
          <h3 className="font-semibold mb-3 text-sm">Azure OpenAI Configuration</h3>
          <div className="flex flex-col gap-3">
            <Input
              label="Azure Endpoint"
              value={azureData.azureEndpoint}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAzureData({ ...azureData, azureEndpoint: e.target.value })}
              placeholder="https://your-resource.openai.azure.com"
            />
            <Input
              label="Deployment Name"
              value={azureData.deployment}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAzureData({ ...azureData, deployment: e.target.value })}
              placeholder="gpt-4"
            />
            <Input
              label="API Version"
              value={azureData.apiVersion}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAzureData({ ...azureData, apiVersion: e.target.value })}
              placeholder="2024-10-01-preview"
            />
            <Input
              label="Organization"
              value={azureData.organization}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAzureData({ ...azureData, organization: e.target.value })}
              placeholder="Organization ID"
            />
          </div>
        </div>
      )}
    </>
  );
}

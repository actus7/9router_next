"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import Input from "@/shared/components/Input";
import Button from "@/shared/components/Button";
import { Badge } from "@/components/ui/badge";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider, AI_PROVIDERS } from "@/shared/constants/providers";
import Select from "@/shared/components/Select";
import { X } from "lucide-react";
import { translate } from "@/i18n/runtime";

interface Connection {
  id: string;
  name?: string;
  email?: string;
  priority?: number;
  authType?: string;
  provider?: string;
  providerSpecificData?: Record<string, unknown>;
}

interface ProxyPool {
  id: string;
  name: string;
}

interface ProviderRegion {
  id: string;
  label: string;
}

interface EditConnectionModalProps {
  isOpen: boolean;
  connection: Connection | null;
  proxyPools?: ProxyPool[];
  onSave: (updates: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}

export default function EditConnectionModal({ isOpen, connection, proxyPools, onSave, onClose }: EditConnectionModalProps) {
  const [formData, setFormData] = useState({
    name: "",
    priority: 1,
    apiKey: "",
  });
  const [azureData, setAzureData] = useState({
    azureEndpoint: "",
    apiVersion: "2024-10-01-preview",
    deployment: "",
    organization: "",
  });
  const [cloudflareData, setCloudflareData] = useState({ accountId: "" });
  const [region, setRegion] = useState<string>("");
  const [testing, setTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [validating, setValidating] = useState<boolean>(false);
  const [validationResult, setValidationResult] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    if (connection) {
      setFormData({
        name: connection.name || "",
        priority: connection.priority || 1,
        apiKey: "",
      });
      // Load Azure-specific data if present
      if (connection.provider === "azure" && connection.providerSpecificData) {
        const psd = connection.providerSpecificData;
        setAzureData({
          azureEndpoint: (psd.azureEndpoint as string) || "",
          apiVersion: (psd.apiVersion as string) || "2024-10-01-preview",
          deployment: (psd.deployment as string) || "",
          organization: (psd.organization as string) || "",
        });
      }
      if (connection.provider === "cloudflare-ai" && connection.providerSpecificData) {
        setCloudflareData({ accountId: (connection.providerSpecificData.accountId as string) || "" });
      }
      // Load region for providers that support it (e.g. xiaomi-tokenplan)
      const providerCfg = AI_PROVIDERS?.[connection.provider as keyof typeof AI_PROVIDERS] as Record<string, unknown> | undefined;
      if (providerCfg?.regions) {
        const regions = providerCfg.regions as ProviderRegion[];
        const savedRegion = (connection.providerSpecificData?.region as string) || (providerCfg.defaultRegion as string) || regions[0]?.id || "";
        setRegion(savedRegion);
      }
      setTestResult(null);
      setValidationResult(null);
    }
  }, [connection]);

  const isOAuth = connection?.authType === "oauth";
  const isAzure = connection?.provider === "azure";
  const isCloudflareAi = connection?.provider === "cloudflare-ai";
  const isCompatible = connection
    ? (isOpenAICompatibleProvider(connection.provider ?? "") || isAnthropicCompatibleProvider(connection.provider ?? ""))
    : false;
  const providerRegions: ProviderRegion[] | null = connection
    ? ((AI_PROVIDERS?.[connection.provider as keyof typeof AI_PROVIDERS] as Record<string, unknown>)?.regions as ProviderRegion[] || null)
    : null;

  // Build providerSpecificData for region-aware providers
  const buildRegionSpecificData = (): Record<string, unknown> | undefined => {
    if (providerRegions && region) return { ...((connection?.providerSpecificData) || {}), region };
    return undefined;
  };

  const handleTest = async () => {
    if (!connection?.provider) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/providers/${connection.id}/test`, { method: "POST" });
      const data = await res.json();
      setTestResult(data.valid ? "success" : "failed");
    } catch {
      setTestResult("failed");
    } finally {
      setTesting(false);
    }
  };

  const handleValidate = async () => {
    if (!connection?.provider || !formData.apiKey) return;
    setValidating(true);
    setValidationResult(null);
    try {
      const res = await fetch("/api/providers/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: connection.provider,
          apiKey: formData.apiKey,
          ...(isAzure ? { providerSpecificData: azureData } : {}),
          ...(isCloudflareAi ? { providerSpecificData: cloudflareData } : {}),
          ...(providerRegions ? { providerSpecificData: buildRegionSpecificData() } : {}),
        }),
      });
      const data = await res.json();
      setValidationResult(data.valid ? "success" : "failed");
    } catch {
      setValidationResult("failed");
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = async () => {
    if (!connection) return;
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {
        name: formData.name,
        priority: formData.priority,
      };
      if (!isOAuth && formData.apiKey) {
        updates.apiKey = formData.apiKey;
        let isValid = validationResult === "success";
        if (!isValid) {
          try {
            setValidating(true);
            setValidationResult(null);
            const res = await fetch("/api/providers/validate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                provider: connection.provider,
                apiKey: formData.apiKey,
                ...(isAzure ? { providerSpecificData: azureData } : {}),
                ...(isCloudflareAi ? { providerSpecificData: cloudflareData } : {}),
                ...(providerRegions ? { providerSpecificData: buildRegionSpecificData() } : {}),
              }),
            });
            const data = await res.json();
            isValid = !!data.valid;
            setValidationResult(isValid ? "success" : "failed");
          } catch {
            setValidationResult("failed");
          } finally {
            setValidating(false);
          }
        }
        if (isValid) {
          updates.testStatus = "active";
          updates.lastError = null;
          updates.lastErrorAt = null;
        }
      }
      
      // Add Azure-specific data if this is an Azure connection
      if (isAzure) {
        updates.providerSpecificData = {
          azureEndpoint: azureData.azureEndpoint,
          apiVersion: azureData.apiVersion,
          deployment: azureData.deployment,
          organization: azureData.organization,
        };
      }
      if (isCloudflareAi) {
        updates.providerSpecificData = { accountId: cloudflareData.accountId };
      }
      // Persist updated region for region-aware providers
      if (providerRegions && region) {
        updates.providerSpecificData = buildRegionSpecificData();
      }
      
      await onSave(updates);
    } finally {
      setSaving(false);
    }
  };

  if (!connection) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "bg-surface border border-border-subtle rounded-[14px]",
          "shadow-[var(--shadow-elev)] ring-0 gap-0 p-0",
          "max-w-md"
        )}
      >
        <div className="flex items-center justify-between p-2 border-b border-border-subtle">
          <DialogTitle className="text-lg font-semibold text-text-main ml-2">
            {translate("Edit Connection") || "Edit Connection"}
          </DialogTitle>
          <Button onClick={onClose} aria-label={translate("Close") || "Close"} variant="ghost" size="sm" className="p-1.5">
            <X className="size-5" />
          </Button>
        </div>
        <div className="p-6 max-h-[calc(85vh-100px)] overflow-y-auto custom-scrollbar">
          <div className="flex flex-col gap-4">
        <Input
          label={translate("Name") || "Name"}
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={isOAuth ? translate("Account name") || "Account name" : translate("Production Key") || "Production Key"}
        />
        {isOAuth && connection.email && (
          <div className="bg-sidebar/50 p-3 rounded-lg">
            <p className="text-sm text-text-muted mb-1">{translate("Email") || "Email"}</p>
            <p className="font-medium">{connection.email}</p>
          </div>
        )}
        <Input
          label={translate("Priority") || "Priority"}
          type="number"
          value={formData.priority}
          onChange={(e) => setFormData({ ...formData, priority: Number.parseInt(e.target.value, 10) || 1 })}
        />

        {!isOAuth && (
          <>
            <div className="flex gap-2">
              <Input
                label={translate("API Key") || "API Key"}
                type="password"
                value={formData.apiKey}
                onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                placeholder={translate("Enter new API key") || "Enter new API key"}
                hint={translate("Leave blank to keep the current API key") || "Leave blank to keep the current API key"}
                className="flex-1"
              />
              <div className="pt-6">
                <Button onClick={handleValidate} disabled={!formData.apiKey || validating || saving} variant="secondary">
                  {validating ? translate("Verifying...") || "Verifying..." : translate("Verify") || "Verify"}
                </Button>
              </div>
            </div>
            {validationResult && (
              <Badge variant={validationResult === "success" ? "default" : "destructive"} className={validationResult === "success" ? "bg-green-500/10 text-green-600 dark:text-green-400" : undefined}>
                {validationResult === "success" ? translate("Valid") || "Valid" : translate("Invalid") || "Invalid"}
              </Badge>
            )}
          </>
        )}

        {isAzure && (
          <div className="bg-sidebar/50 p-4 rounded-lg border border-accent/20">
            <h3 className="font-semibold mb-3 text-sm">{translate("Azure OpenAI Configuration") || "Azure OpenAI Configuration"}</h3>
            <div className="flex flex-col gap-3">
              <Input
                label={translate("Azure Endpoint") || "Azure Endpoint"}
                value={azureData.azureEndpoint}
                onChange={(e) => setAzureData({ ...azureData, azureEndpoint: e.target.value })}
                placeholder="https://your-resource.openai.azure.com"
                hint={translate("Azure OpenAI resource endpoint URL") || "Azure OpenAI resource endpoint URL"}
              />
              <Input
                label={translate("Deployment Name") || "Deployment Name"}
                value={azureData.deployment}
                onChange={(e) => setAzureData({ ...azureData, deployment: e.target.value })}
                placeholder="gpt-4"
                hint={translate("The deployment name in your Azure resource") || "The deployment name in your Azure resource"}
              />
              <Input
                label={translate("API Version") || "API Version"}
                value={azureData.apiVersion}
                onChange={(e) => setAzureData({ ...azureData, apiVersion: e.target.value })}
                placeholder="2024-10-01-preview"
                hint={translate("Azure OpenAI API version to use") || "Azure OpenAI API version to use"}
              />
              <Input
                label={translate("Organization") || "Organization"}
                value={azureData.organization}
                onChange={(e) => setAzureData({ ...azureData, organization: e.target.value })}
                placeholder={translate("Organization ID") || "Organization ID"}
                hint={translate("Required for billing") || "Required for billing"}
              />
            </div>
          </div>
        )}

        {providerRegions && (
          <Select
            label={translate("Region") || "Region"}
            value={region}
            onChange={(value) => setRegion(value)}
            options={providerRegions.map((r) => ({ value: r.id, label: r.label }))}
          />
        )}

        {!isCompatible && !isAzure && !isCloudflareAi && (
          <div className="flex items-center gap-3">
            <Button onClick={handleTest} variant="secondary" disabled={testing}>
              {testing ? translate("Testing...") || "Testing..." : translate("Test connection") || "Test connection"}
            </Button>
            {testResult && (
              <Badge variant={testResult === "success" ? "default" : "destructive"} className={testResult === "success" ? "bg-green-500/10 text-green-600 dark:text-green-400" : undefined}>
                {testResult === "success" ? translate("Valid") || "Valid" : translate("Failed") || "Failed"}
              </Badge>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={saving}>{saving ? translate("Saving...") || "Saving..." : translate("Save") || "Save"}</Button>
          <Button onClick={onClose} variant="ghost" fullWidth>{translate("Cancel") || "Cancel"}</Button>
        </div>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

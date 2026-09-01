"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import Input from "@/shared/components/Input";
import Button from "@/shared/components/Button";
import { Badge } from "@/components/ui/badge";
import Select from "@/shared/components/Select";
import { X } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { useEditConnectionForm } from "./useEditConnectionForm";
import { testProviderConnection, validateProviderKey } from "./editConnectionActions";

interface Connection {
  id: string; name?: string; email?: string; priority?: number;
  authType?: string; provider?: string; providerSpecificData?: Record<string, unknown>;
}

interface EditConnectionModalProps {
  isOpen: boolean; connection: Connection | null;
  onSave: (updates: Record<string, unknown>) => Promise<void>; onClose: () => void;
}

export default function EditConnectionModal({ isOpen, connection, onSave, onClose }: EditConnectionModalProps) {
  const f = useEditConnectionForm(connection);

  const handleTest = () => { if (connection) testProviderConnection(connection.id, f.setTestResult, f.setTesting); };

  const handleValidate = async () => {
    if (!connection?.provider || !f.formData.apiKey) return;
    await validateProviderKey({
      provider: connection.provider, apiKey: f.formData.apiKey,
      isAzure: f.isAzure, azureData: f.azureData,
      isCloudflareAi: f.isCloudflareAi, cloudflareData: f.cloudflareData,
      providerRegions: f.providerRegions, regionData: f.buildRegionSpecificData(),
      setValidationResult: f.setValidationResult, setValidating: f.setValidating,
    });
  };

  const handleSubmit = async () => {
    if (!connection) return;
    f.setSaving(true);
    try {
      const updates: Record<string, unknown> = { name: f.formData.name, priority: f.formData.priority };
      if (!f.isOAuth && f.formData.apiKey) {
        updates.apiKey = f.formData.apiKey;
        let isValid = f.validationResult === "success";
        if (!isValid) isValid = await validateProviderKey({
          provider: connection.provider!, apiKey: f.formData.apiKey,
          isAzure: f.isAzure, azureData: f.azureData,
          isCloudflareAi: f.isCloudflareAi, cloudflareData: f.cloudflareData,
          providerRegions: f.providerRegions, regionData: f.buildRegionSpecificData(),
          setValidationResult: f.setValidationResult, setValidating: f.setValidating,
        });
        if (isValid) { updates.testStatus = "active"; updates.lastError = null; updates.lastErrorAt = null; }
      }
      if (f.isAzure) updates.providerSpecificData = { azureEndpoint: f.azureData.azureEndpoint, apiVersion: f.azureData.apiVersion, deployment: f.azureData.deployment, organization: f.azureData.organization };
      if (f.isCloudflareAi) updates.providerSpecificData = { accountId: f.cloudflareData.accountId };
      if (f.providerRegions && f.region) updates.providerSpecificData = f.buildRegionSpecificData();
      await onSave(updates);
    } finally { f.setSaving(false); }
  };

  if (!connection) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className={cn("bg-surface border border-border-subtle rounded-[14px]", "shadow-[var(--shadow-elev)] ring-0 gap-0 p-0", "max-w-md")}>
        <div className="flex items-center justify-between p-2 border-b border-border-subtle">
          <DialogTitle className="text-lg font-semibold text-text-main ml-2">{translate("Edit Connection") || "Edit Connection"}</DialogTitle>
          <Button onClick={onClose} aria-label={translate("Close") || "Close"} variant="ghost" size="sm" className="p-1.5"><X className="size-5" /></Button>
        </div>
        <div className="p-6 max-h-[calc(85vh-100px)] overflow-y-auto custom-scrollbar">
          <div className="flex flex-col gap-4">
            <Input label={translate("Name") || "Name"} value={f.formData.name} onChange={(e) => f.setFormData({ ...f.formData, name: e.target.value })} placeholder={f.isOAuth ? translate("Account name") || "Account name" : translate("Production Key") || "Production Key"} />
            {f.isOAuth && connection.email && (<div className="bg-sidebar/50 p-3 rounded-lg"><p className="text-sm text-text-muted mb-1">{translate("Email") || "Email"}</p><p className="font-medium">{connection.email}</p></div>)}
            <Input label={translate("Priority") || "Priority"} type="number" value={f.formData.priority} onChange={(e) => f.setFormData({ ...f.formData, priority: Number.parseInt(e.target.value, 10) || 1 })} />
            {!f.isOAuth && (<>
              <div className="flex gap-2">
                <Input label={translate("API Key") || "API Key"} type="password" value={f.formData.apiKey} onChange={(e) => f.setFormData({ ...f.formData, apiKey: e.target.value })} placeholder={translate("Enter new API key") || "Enter new API key"} hint={translate("Leave blank to keep the current API key") || "Leave blank to keep the current API key"} className="flex-1" />
                <div className="pt-6"><Button onClick={handleValidate} disabled={!f.formData.apiKey || f.validating || f.saving} variant="secondary">{f.validating ? translate("Verifying...") || "Verifying..." : translate("Verify") || "Verify"}</Button></div>
              </div>
              {f.validationResult && (<Badge variant={f.validationResult === "success" ? "default" : "destructive"} className={f.validationResult === "success" ? "bg-green-500/10 text-green-600 dark:text-green-400" : undefined}>{f.validationResult === "success" ? translate("Valid") || "Valid" : translate("Invalid") || "Invalid"}</Badge>)}
            </>)}
            {f.isAzure && (
              <div className="bg-sidebar/50 p-4 rounded-lg border border-accent/20">
                <h3 className="font-semibold mb-3 text-sm">{translate("Azure OpenAI Configuration") || "Azure OpenAI Configuration"}</h3>
                <div className="flex flex-col gap-3">
                  <Input label={translate("Azure Endpoint") || "Azure Endpoint"} value={f.azureData.azureEndpoint} onChange={(e) => f.setAzureData({ ...f.azureData, azureEndpoint: e.target.value })} placeholder="https://your-resource.openai.azure.com" hint={translate("Azure OpenAI resource endpoint URL") || "Azure OpenAI resource endpoint URL"} />
                  <Input label={translate("Deployment Name") || "Deployment Name"} value={f.azureData.deployment} onChange={(e) => f.setAzureData({ ...f.azureData, deployment: e.target.value })} placeholder="gpt-4" hint={translate("The deployment name in your Azure resource") || "The deployment name in your Azure resource"} />
                  <Input label={translate("API Version") || "API Version"} value={f.azureData.apiVersion} onChange={(e) => f.setAzureData({ ...f.azureData, apiVersion: e.target.value })} placeholder="2024-10-01-preview" hint={translate("Azure OpenAI API version to use") || "Azure OpenAI API version to use"} />
                  <Input label={translate("Organization") || "Organization"} value={f.azureData.organization} onChange={(e) => f.setAzureData({ ...f.azureData, organization: e.target.value })} placeholder={translate("Organization ID") || "Organization ID"} hint={translate("Required for billing") || "Required for billing"} />
                </div>
              </div>
            )}
            {f.providerRegions && (<Select label={translate("Region") || "Region"} value={f.region} onChange={(value) => f.setRegion(value)} options={f.providerRegions.map((r) => ({ value: r.id, label: r.label }))} />)}
            {!f.isCompatible && !f.isAzure && !f.isCloudflareAi && (
              <div className="flex items-center gap-3">
                <Button onClick={handleTest} variant="secondary" disabled={f.testing}>{f.testing ? translate("Testing...") || "Testing..." : translate("Test connection") || "Test connection"}</Button>
                {f.testResult && (<Badge variant={f.testResult === "success" ? "default" : "destructive"} className={f.testResult === "success" ? "bg-green-500/10 text-green-600 dark:text-green-400" : undefined}>{f.testResult === "success" ? translate("Valid") || "Valid" : translate("Failed") || "Failed"}</Badge>)}
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={handleSubmit} fullWidth disabled={f.saving}>{f.saving ? translate("Saving...") || "Saving..." : translate("Save") || "Save"}</Button>
              <Button onClick={onClose} variant="ghost" fullWidth>{translate("Cancel") || "Cancel"}</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

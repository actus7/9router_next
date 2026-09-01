"use client";

import { Button, Input, Select } from "@/shared/components";
import { translate } from "@/i18n/runtime";

interface FormFooterProps {
  isCompatible: boolean;
  isAzure: boolean;
  isCloudflareAi: boolean;
  defaultModel: string;
  onDefaultModelChange: (value: string) => void;
  isAnthropic?: boolean;
  priority: number;
  onPriorityChange: (value: number) => void;
  proxyPoolId: string;
  onProxyPoolChange: (value: string) => void;
  proxyPools?: Array<{ id: string; name: string }>;
  noneProxyPoolValue: string;
  saving: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  onClose: () => void;
}

export default function FormFooter({
  isCompatible, isAzure: _isAzure, isCloudflareAi: _isCloudflareAi, defaultModel, onDefaultModelChange, isAnthropic,
  priority, onPriorityChange, proxyPoolId, onProxyPoolChange, proxyPools, noneProxyPoolValue,
  saving, canSubmit, onSubmit, onClose,
}: FormFooterProps) {
  return (
    <>
      {isCompatible && (
        <Input label="Default Model" value={defaultModel} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onDefaultModelChange(e.target.value)} placeholder={isAnthropic ? "claude-3-5-sonnet-latest" : "gpt-4o-mini"} />
      )}
      {isCompatible && (
        <p className="text-xs text-text-muted">Enter the model ID exactly as your compatible endpoint expects it. This model will be saved as the connection default.</p>
      )}
      <Input label="Priority" type="number" value={priority} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onPriorityChange(Number.parseInt(e.target.value) || 1)} />
      <Select label="Proxy Pool" value={proxyPoolId} onChange={(value: string) => onProxyPoolChange(value)} options={[{ value: noneProxyPoolValue, label: "None" }, ...(proxyPools || []).map((pool) => ({ value: pool.id, label: pool.name }))]} placeholder="None" />
      {(proxyPools || []).length === 0 && (
        <p className="text-xs text-text-muted">No active proxy pools available. Create one in Proxy Pools page first.</p>
      )}
      <p className="text-xs text-text-muted">Legacy manual proxy fields are still accepted by API for backward compatibility.</p>
      <div className="flex gap-2">
        <Button onClick={onSubmit} fullWidth disabled={saving || !canSubmit}>
          {saving ? translate("Saving...") : translate("Save")}
        </Button>
        <Button onClick={onClose} variant="ghost" fullWidth>{translate("Cancel")}</Button>
      </div>
    </>
  );
}

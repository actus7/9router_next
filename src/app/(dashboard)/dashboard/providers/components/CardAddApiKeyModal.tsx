"use client";

import { useState } from "react";
import { Modal, Select } from "@/shared/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { translate } from "@/i18n/runtime";
import type { CardProxyPool } from "./CardConnectionRow";

interface CardAddApiKeyModalProps {
  isOpen: boolean;
  provider?: string;
  providerName?: string;
  proxyPools?: CardProxyPool[];
  onSave: (formData: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}

export default function CardAddApiKeyModal({ isOpen, provider, providerName, proxyPools, onSave, onClose }: CardAddApiKeyModalProps) {
  const NONE = "__none__";
  const [formData, setFormData] = useState({ name: "", apiKey: "", priority: 1, proxyPoolId: NONE });
  const [validating, setValidating] = useState<boolean>(false);
  const [validationResult, setValidationResult] = useState<"success" | "failed" | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch("/api/providers/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: formData.apiKey }),
      });
      const data = await res.json();
      setValidationResult(data.valid ? "success" : "failed");
    } catch { setValidationResult("failed"); }
    finally { setValidating(false); }
  };

  const handleSubmit = async () => {
    if (!provider || !formData.apiKey) return;
    setSaving(true);
    try {
      let isValid = false;
      try {
        setValidating(true); setValidationResult(null);
        const res = await fetch("/api/providers/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, apiKey: formData.apiKey }),
        });
        const data = await res.json();
        isValid = !!data.valid;
        setValidationResult(isValid ? "success" : "failed");
      } catch { setValidationResult("failed"); }
      finally { setValidating(false); }
      await onSave({
        name: formData.name,
        apiKey: formData.apiKey,
        priority: formData.priority,
        proxyPoolId: formData.proxyPoolId === NONE ? null : formData.proxyPoolId,
        testStatus: isValid ? "active" : "unknown",
      });
    } finally { setSaving(false); }
  };

  if (!provider) return null;

  return (
    <Modal isOpen={isOpen} title={`Add ${providerName || provider} API Key`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <Label className="text-xs text-text-muted mb-1 block">{translate("Name")}</Label>
          <Input className="w-full px-3 py-2 text-sm" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Production Key" />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <Label className="text-xs text-text-muted mb-1 block">{translate("API Key")}</Label>
            <Input type="password" className="w-full px-3 py-2 text-sm" value={formData.apiKey} onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })} />
          </div>
          <div className="pt-6">
            <Button onClick={handleValidate} disabled={!formData.apiKey || validating || saving} variant="secondary">
              {validating ? translate("Checking...") : translate("Check")}
            </Button>
          </div>
        </div>
        {validationResult && (
          <Badge variant={validationResult === "success" ? "default" : "destructive"} className={validationResult === "success" ? "bg-success text-success-foreground dark:text-success-foreground" : undefined}>
            {validationResult === "success" ? translate("Valid") : translate("Invalid")}
          </Badge>
        )}
        <div>
          <Label className="text-xs text-text-muted mb-1 block">{translate("Priority")}</Label>
          <Input type="number" className="w-full px-3 py-2 text-sm" value={formData.priority} onChange={(e) => setFormData({ ...formData, priority: Number.parseInt(e.target.value) || 1 })} />
        </div>
        <Select label={translate("Proxy Pool") || "Proxy Pool"} value={formData.proxyPoolId} onChange={(val: string) => setFormData({ ...formData, proxyPoolId: val })}
          options={[{ value: NONE, label: translate("None") || "None" }, ...(proxyPools || []).map((p) => ({ value: p.id, label: p.name }))]} />
        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={!formData.name || !formData.apiKey || saving}>
            {saving ? translate("Saving...") : translate("Save")}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>{translate("Cancel")}</Button>
        </div>
      </div>
    </Modal>
  );
}

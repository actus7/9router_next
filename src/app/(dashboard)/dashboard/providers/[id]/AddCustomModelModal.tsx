"use client";

import { useState, useEffect } from "react";
import { Button, Modal } from "@/shared/components";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, FlaskConical, XCircle } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { testCustomModel, stripProviderAlias } from "./customModelHelpers";

interface AddCustomModelModalProps {
  isOpen: boolean;
  providerAlias: string;
  providerDisplayAlias: string;
  onSave: (modelId: string) => Promise<void>;
  onClose: () => void;
}

export default function AddCustomModelModal({ isOpen, providerAlias, providerDisplayAlias: _providerDisplayAlias, onSave, onClose }: AddCustomModelModalProps) {
  const [modelId, setModelId] = useState<string>("");
  const [testStatus, setTestStatus] = useState<null | "testing" | "ok" | "error">(null);
  const [testError, setTestError] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => { if (isOpen) { setModelId(""); setTestStatus(null); setTestError(""); } }, [isOpen]);

  const handleTest = async () => {
    const cleanId = stripProviderAlias(modelId.trim(), providerAlias);
    if (!cleanId) return;
    setTestStatus("testing"); setTestError("");
    const result = await testCustomModel(providerAlias, cleanId);
    setTestStatus(result.status);
    setTestError(result.error);
  };

  const handleSave = async () => {
    const cleanId = stripProviderAlias(modelId.trim(), providerAlias);
    if (!cleanId || saving) return;
    setSaving(true);
    try { await onSave(cleanId); } finally { setSaving(false); }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={translate("Add Custom Model") || "Add Custom Model"}>
      <div className="flex flex-col gap-4">
        <div>
          <Label className="mb-1.5 block">{translate("Model ID")}</Label>
          <div className="flex gap-2">
            <Input type="text" value={modelId} onChange={(e) => { setModelId(e.target.value); setTestStatus(null); setTestError(""); }} onKeyDown={(e) => e.key === "Enter" && handleTest()} placeholder="e.g. claude-opus-4-5" className="flex-1 px-3 py-2 text-sm" autoFocus />
            <Button variant="secondary" icon={<FlaskConical className="size-4" />} loading={testStatus === "testing"} onClick={handleTest} disabled={!modelId.trim() || testStatus === "testing"}>
              {testStatus === "testing" ? translate("Testing...") : translate("Test")}
            </Button>
          </div>
          <p className="text-xs text-text-muted mt-1">{translate("Sent to provider as:")} <code className="font-mono bg-sidebar px-1 rounded">{stripProviderAlias(modelId.trim(), providerAlias) || "model-id"}</code></p>
        </div>
        {testStatus === "ok" && <div className="flex items-center gap-2 text-sm text-green-600"><CheckCircle2 className="size-4" />{translate("Model is reachable")}</div>}
        {testStatus === "error" && <div className="flex items-start gap-2 text-sm text-red-500"><XCircle className="size-4" /><span>{testError || translate("Model is not reachable")}</span></div>}
        <div className="flex gap-2 pt-1">
          <Button onClick={onClose} variant="ghost" fullWidth size="sm">{translate("Cancel")}</Button>
          <Button onClick={handleSave} fullWidth size="sm" disabled={!modelId.trim() || saving}>{saving ? translate("Adding...") : translate("Add Model")}</Button>
        </div>
      </div>
    </Modal>
  );
}

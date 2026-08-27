"use client";

import { useState, useEffect } from "react";
import { Button, Modal } from "@/shared/components";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, FlaskConical, XCircle } from "lucide-react";

interface AddCustomModelModalProps {
  isOpen: boolean;
  providerAlias: string;
  providerDisplayAlias: string;
  onSave: (modelId: string) => Promise<void>;
  onClose: () => void;
}

export default function AddCustomModelModal({ isOpen, providerAlias, providerDisplayAlias, onSave, onClose }: AddCustomModelModalProps) {
  const [modelId, setModelId] = useState<string>("");
  const [testStatus, setTestStatus] = useState<null | "testing" | "ok" | "error">(null);
  const [testError, setTestError] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) { setModelId(""); setTestStatus(null); setTestError(""); }
  }, [isOpen]);

  // Strip provider's own alias prefix (e.g. "cc/model" -> "model" for cc provider)
  const stripAlias = (id: string): string => {
    const prefix = `${providerAlias}/`;
    return id.startsWith(prefix) ? id.slice(prefix.length) : id;
  };

  const handleTest = async () => {
    const cleanId = stripAlias(modelId.trim());
    if (!cleanId) return;
    setTestStatus("testing");
    setTestError("");
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerAlias}/${cleanId}` }),
      });
      const data = await res.json();
      setTestStatus(data.ok ? "ok" : "error");
      setTestError(data.error || "");
    } catch (err: unknown) {
      setTestStatus("error");
      setTestError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const handleSave = async () => {
    const cleanId = stripAlias(modelId.trim());
    if (!cleanId || saving) return;
    setSaving(true);
    try {
      await onSave(cleanId);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleTest();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Custom Model">
      <div className="flex flex-col gap-4">
        <div>
          <Label className="mb-1.5 block">Model ID</Label>
          <div className="flex gap-2">
            <Input
              type="text"
              value={modelId}
              onChange={(e) => { setModelId(e.target.value); setTestStatus(null); setTestError(""); }}
              onKeyDown={handleKeyDown}
              placeholder="e.g. claude-opus-4-5"
              className="flex-1 px-3 py-2 text-sm"
              autoFocus
            />
            <Button
              variant="secondary"
              icon={<FlaskConical className="size-4" />}
              loading={testStatus === "testing"}
              onClick={handleTest}
              disabled={!modelId.trim() || testStatus === "testing"}
            >
              {testStatus === "testing" ? "Testing..." : "Test"}
            </Button>
          </div>
          <p className="text-xs text-text-muted mt-1">
            Sent to provider as: <code className="font-mono bg-sidebar px-1 rounded">{stripAlias(modelId.trim()) || "model-id"}</code>
          </p>
        </div>

        {/* Test result */}
        {testStatus === "ok" && (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <CheckCircle2 className="size-4" />
            Model is reachable
          </div>
        )}
        {testStatus === "error" && (
          <div className="flex items-start gap-2 text-sm text-red-500">
            <XCircle className="size-4" />
            <span>{testError || "Model not reachable"}</span>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button onClick={onClose} variant="ghost" fullWidth size="sm">Cancel</Button>
          <Button
            onClick={handleSave}
            fullWidth
            size="sm"
            disabled={!modelId.trim() || saving}
          >
            {saving ? "Adding..." : "Add Model"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

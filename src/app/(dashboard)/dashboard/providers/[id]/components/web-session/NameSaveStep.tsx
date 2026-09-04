"use client";

import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { FormInput as Input } from "@/shared/components/FormInput";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Select } from "@/shared/components";
import { CheckCircle2, AlertCircle, ChevronDown } from "lucide-react";
import type { CredentialOrigin } from "../../utils/webSessionCredential";

interface ProxyPool {
  id: string;
  name: string;
}

interface NameSaveStepProps {
  provider: string;
  providerName: string;
  credential: string;
  origin: CredentialOrigin;
  proxyPools?: ProxyPool[];
  error?: string;
  existingNames?: string[];
  onSave: (formData: Record<string, unknown>) => Promise<void>;
  onBack: () => void;
  onClose: () => void;
}

const NONE_PROXY_POOL_VALUE = "__none__";

function maskCredential(value: string): string {
  if (value.length <= 12) return "••••••••";
  return `${value.slice(0, 4)}${"•".repeat(Math.min(value.length - 8, 32))}${value.slice(-4)}`;
}

export default function NameSaveStep({
  provider,
  providerName,
  credential,
  origin: _origin,
  proxyPools,
  error,
  existingNames,
  onSave,
  onBack,
  onClose,
}: NameSaveStepProps) {
  const [name, setName] = useState("");
  const [priority, setPriority] = useState(1);
  const [proxyPoolId, setProxyPoolId] = useState(NONE_PROXY_POOL_VALUE);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<"success" | "failed" | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  const nameExists = existingNames?.some((n) => n.toLowerCase() === name.trim().toLowerCase());
  const canSave = !!name.trim() && !nameExists;

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    setValidationResult(null);

    // Validate credential via the same endpoint as API key flow
    let validated = false;
    try {
      setValidating(true);
      const res = await fetch("/api/providers/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: credential }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.valid) {
        validated = true;
        setValidationResult("success");
      } else {
        setValidationResult("failed");
      }
    } catch {
      setValidationResult("failed");
    } finally {
      setValidating(false);
    }

    try {
      await onSave({
        name: name.trim(),
        apiKey: credential,
        priority,
        proxyPoolId: proxyPoolId === NONE_PROXY_POOL_VALUE ? null : proxyPoolId,
        validated,
      });
    } finally {
      setSaving(false);
    }
  }, [canSave, provider, credential, name, priority, proxyPoolId, onSave]);

  return (
    <div className="flex flex-col gap-5">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <span className="flex items-center justify-center size-5 rounded-full bg-success text-success-foreground text-[10px] font-semibold" aria-hidden="true">✓</span>
        <span>Session captured</span>
        <span className="text-border" aria-hidden="true">→</span>
        <span className="flex items-center justify-center size-5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold" aria-hidden="true">2</span>
        <span className="font-medium">Name &amp; save</span>
      </div>

      {/* Masked credential summary */}
      <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
        <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" />
        <code className="text-xs font-mono text-text-muted truncate flex-1" aria-label="Masked credential">
          {maskCredential(credential)}
        </code>
        <Button variant="ghost" size="xs" onClick={onBack}>
          Change
        </Button>
      </div>

      {/* Name input */}
      <Input
        label="Connection Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={`${providerName} Session`}
        error={nameExists ? "A connection with this name already exists" : undefined}
        required
        autoFocus
      />

      {/* Advanced options */}
      <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
        <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-text-muted hover:text-foreground transition-colors min-h-[44px]">
          <ChevronDown className={`size-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`} aria-hidden="true" />
          Advanced options
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-3 pt-3">
          <Input
            label="Priority"
            type="number"
            value={priority}
            onChange={(e) => setPriority(Number.parseInt(e.target.value) || 1)}
          />
          <Select
            label="Proxy Pool"
            value={proxyPoolId}
            onChange={(value: string) => setProxyPoolId(value)}
            options={[
              { value: NONE_PROXY_POOL_VALUE, label: "None" },
              ...(proxyPools || []).map((pool) => ({ value: pool.id, label: pool.name })),
            ]}
            placeholder="None"
          />
          {(proxyPools || []).length === 0 && (
            <p className="text-xs text-text-muted">No active proxy pools available.</p>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Validation feedback — live region */}
      {validationResult && (
        <div
          aria-live="polite"
          className={`flex items-center gap-2 rounded-lg border p-3 text-xs ${
            validationResult === "success"
              ? "border-success/30 bg-success/5 text-success"
              : "border-warning/30 bg-warning/5 text-warning"
          }`}
        >
          {validationResult === "success" ? (
            <><CheckCircle2 className="size-3.5" aria-hidden="true" /> Credential validated successfully</>
          ) : (
            <><AlertCircle className="size-3.5" aria-hidden="true" /> Could not validate credential — connection will be saved as unverified</>
          )}
        </div>
      )}

      {/* API-level error — live region */}
      {error && (
        <div ref={errorRef} role="alert" aria-live="assertive" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <AlertCircle className="size-4 shrink-0 text-destructive mt-0.5" aria-hidden="true" />
          <p className="text-xs text-destructive break-words">{error}</p>
        </div>
      )}

      {/* Save buttons */}
      <div className="flex gap-2">
        <Button
          onClick={handleSave}
          fullWidth
          disabled={saving || validating || !canSave}
          loading={saving || validating}
        >
          {saving || validating ? "Saving..." : "Save Connection"}
        </Button>
        <Button onClick={onClose} variant="ghost" fullWidth>
          Cancel
        </Button>
      </div>
    </div>
  );
}

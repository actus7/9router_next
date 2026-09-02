"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { planBulkAdd } from "@/shared/utils/bulkAdd";

interface BulkAddFormProps {
  provider?: string;
  isCloudflareAi: boolean;
  bulkPlaceholder: string;
  existingNames?: string[];
  onBulkDone?: () => void;
  onClose: () => void;
}

export default function BulkAddForm({
  provider,
  isCloudflareAi,
  bulkPlaceholder,
  existingNames,
  onBulkDone,
  onClose,
}: BulkAddFormProps) {
  const [bulkText, setBulkText] = useState<string>("");
  const [bulkResult, setBulkResult] = useState<{ success: number; failed: number } | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  const handleBulkSubmit = async () => {
    const lines = bulkText.split("\n");
    if (!lines.length) return;
    const plan = planBulkAdd(lines, existingNames, { isCloudflareAi });
    if (!plan.length) return;
    setSaving(true);
    setBulkResult(null);
    let success = 0;
    let failed = 0;
    for (const entry of plan) {
      try {
        let isValid = false;
        try {
          const vres = await fetch("/api/providers/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider, apiKey: entry.apiKey }),
          });
          const vdata = await vres.json().catch(() => ({}));
          isValid = !!vdata.valid;
        } catch {
          isValid = false;
        }
        const res = await fetch("/api/providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            apiKey: entry.apiKey,
            name: entry.name,
            priority: 1,
            testStatus: isValid ? "active" : "unknown",
            ...(entry.providerSpecificData ? { providerSpecificData: entry.providerSpecificData } : {}),
          }),
        });
        if (res.ok) success++;
        else failed++;
      } catch {
        failed++;
      }
    }
    setSaving(false);
    setBulkResult({ success, failed });
    if (success > 0 && onBulkDone) onBulkDone();
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-text-muted">
        {isCloudflareAi
          ? <>One key per line. Format: <code>name|apiKey|accountId</code> or just <code>apiKey</code> (auto-named by index).</>
          : provider === "qoder"
            ? <>One PAT per line. Format: <code>name|pt-...</code> or just <code>pt-...</code> (auto-named by index).</>
            : <>One key per line. Format: <code>name|apiKey</code> or just <code>apiKey</code> (auto-named by index).</>
        }
      </p>
      <Textarea
        className="font-mono min-h-[140px]"
        placeholder={bulkPlaceholder}
        value={bulkText}
        onChange={(e) => setBulkText(e.target.value)}
      />
      {bulkResult && (
        <div className={`text-sm font-medium ${bulkResult.failed > 0 ? "text-warning" : "text-success"}`}>
          ✓ {bulkResult.success} added{bulkResult.failed > 0 ? `, ✗ ${bulkResult.failed} failed` : ""}
        </div>
      )}
      <div className="flex gap-2">
        <Button onClick={handleBulkSubmit} fullWidth disabled={saving || !bulkText.trim()}>
          {saving ? "Adding..." : "Add All Keys"}
        </Button>
        <Button onClick={onClose} variant="ghost" fullWidth>Cancel</Button>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Modal } from "@/shared/components";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { translate } from "@/i18n/runtime";
import { submitBulkImport } from "./bulkImportHelpers";

const PLACEHOLDER = `[
  {
    "accessToken": "eyJhbGc...",
    "refreshToken": "rt_...",
    "idToken": "eyJhbGc...",
    "email": "user@example.com"
  }
]`;

interface BulkImportResult {
  success: number;
  failed: number;
  results?: Array<{ ok: boolean; index: number; error?: string }>;
}

interface BulkImportCodexModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function BulkImportCodexModal({ isOpen, onClose, onSuccess }: BulkImportCodexModalProps) {
  const [jsonText, setJsonText] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [parseError, setParseError] = useState<string>("");
  const [result, setResult] = useState<BulkImportResult | null>(null);

  const handleClose = () => {
    if (submitting) return;
    setJsonText(""); setParseError(""); setResult(null); onClose();
  };

  const handleSubmit = async () => {
    setParseError(""); setResult(null);
    setSubmitting(true);
    const { result: res, error } = await submitBulkImport(jsonText);
    setSubmitting(false);
    if (error) { setParseError(error); return; }
    if (res) {
      setResult(res);
      if (res.success > 0 && typeof onSuccess === "function") onSuccess();
    }
  };

  const failedItems = result?.results?.filter((r) => !r.ok) || [];

  return (
    <Modal isOpen={isOpen} title={translate("Bulk Add Codex Accounts") ?? undefined} onClose={handleClose}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-text-muted">{translate("Paste an array of codex account JSON objects. Each must include accessToken (and ideally refreshToken, idToken).")}</p>
        <Textarea className="font-mono min-h-[240px]" placeholder={PLACEHOLDER} value={jsonText} onChange={(e) => setJsonText(e.target.value)} disabled={submitting} />
        {parseError && <p className="text-xs text-destructive break-words">{parseError}</p>}
        {result && (
          <div className="flex flex-col gap-2">
            <div className={`text-sm font-medium ${result.failed > 0 ? "text-warning" : "text-success"}`}>
              ✓ {result.success} {translate("added")}{result.failed > 0 ? `, ✗ ${result.failed} ${translate("failed")}` : ""}
            </div>
            {failedItems.length > 0 && (
              <ul className="rounded border border-accent/20 bg-sidebar/50 p-2 text-xs font-mono max-h-40 overflow-y-auto">
                {failedItems.map((item) => <li key={item.index} className="text-destructive-foreground">[{item.index}] {item.error}</li>)}
              </ul>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={submitting || !jsonText.trim()}>{submitting ? translate("Importing...") : translate("Import All")}</Button>
          <Button onClick={handleClose} variant="ghost" fullWidth disabled={submitting}>{translate("Close")}</Button>
        </div>
      </div>
    </Modal>
  );
}

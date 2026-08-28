"use client";

import { useState } from "react";
import { Button, Modal } from "@/shared/components";
import { Textarea } from "@/components/ui/textarea";
import { translate } from "@/i18n/runtime";

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

function normalizeToArray(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.accounts)) return obj.accounts;
    return [parsed];
  }
  return null;
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
    setJsonText("");
    setParseError("");
    setResult(null);
    onClose();
  };

  const handleSubmit = async () => {
    setParseError("");
    setResult(null);

    const trimmed = jsonText.trim();
    if (!trimmed) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err: unknown) {
      setParseError(`${translate("Invalid JSON")}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const accounts = normalizeToArray(parsed);
    if (!accounts || accounts.length === 0) {
      setParseError(translate("No accounts found in input") || "");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/oauth/codex/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts }),
      });
      const data: BulkImportResult = await res.json();
      if (!res.ok) {
        setParseError((data as unknown as { error?: string })?.error || `Request failed: ${res.status}`);
        return;
      }
      setResult(data);
      if (data.success > 0 && typeof onSuccess === "function") {
        onSuccess();
      }
    } catch (err: unknown) {
      setParseError(err instanceof Error ? err.message : (translate("Request failed") || ""));
    } finally {
      setSubmitting(false);
    }
  };

  const failedItems = result?.results?.filter((r) => !r.ok) || [];

  return (
    <Modal isOpen={isOpen} title={translate("Bulk Add Codex Accounts") ?? undefined} onClose={handleClose}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-text-muted">
          {translate(
            "Paste an array of codex account JSON objects. Each must include accessToken (and ideally refreshToken, idToken)."
          )}
        </p>

        <Textarea
          className="font-mono min-h-[240px]"
          placeholder={PLACEHOLDER}
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          disabled={submitting}
        />

        {parseError && (
          <p className="text-xs text-red-500 break-words">{parseError}</p>
        )}

        {result && (
          <div className="flex flex-col gap-2">
            <div
              className={`text-sm font-medium ${
                result.failed > 0 ? "text-yellow-400" : "text-green-400"
              }`}
            >
              ✓ {result.success} {translate("added")}
              {result.failed > 0 ? `, ✗ ${result.failed} ${translate("failed")}` : ""}
            </div>
            {failedItems.length > 0 && (
              <ul className="rounded border border-accent/20 bg-sidebar/50 p-2 text-xs font-mono max-h-40 overflow-y-auto">
                {failedItems.map((item) => (
                  <li key={item.index} className="text-red-400">
                    [{item.index}] {item.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            onClick={handleSubmit}
            fullWidth
            disabled={submitting || !jsonText.trim()}
          >
            {submitting ? translate("Importing...") : translate("Import All")}
          </Button>
          <Button onClick={handleClose} variant="ghost" fullWidth disabled={submitting}>
            {translate("Close")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

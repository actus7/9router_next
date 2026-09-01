"use client";

import { Badge } from "@/components/ui/badge";
import { translate } from "@/i18n/runtime";

interface ValidationResult { valid?: boolean; error?: string; dimensions?: number; }

export function EmbeddingValidationResult({ result }: { result: ValidationResult | null }) {
  if (!result) return null;
  if (result.valid) {
    return (
      <>
        <Badge variant="default" className="bg-success text-success-foreground dark:text-success-foreground">{translate("Valid") || "Valid"}</Badge>
        {result.dimensions && <span className="text-sm text-text-muted">{result.dimensions} {translate("Dimensions") || "Dimensions"}</span>}
      </>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <Badge variant="destructive">{translate("Invalid") || "Invalid"}</Badge>
      {result.error && <span className="text-sm text-destructive-foreground">{result.error}</span>}
    </div>
  );
}

interface EmbeddingNode { id: string; name?: string; prefix?: string; baseUrl?: string; }

export async function submitEmbeddingNode(params: {
  isEdit: boolean; nodeId?: string;
  name: string; prefix: string; baseUrl: string;
  onCreated?: (node: EmbeddingNode) => void; onSaved?: (node: EmbeddingNode) => void;
  setSubmitting: (v: boolean) => void;
}) {
  const { isEdit, nodeId, name, prefix, baseUrl, onCreated, onSaved, setSubmitting } = params;
  if (!name.trim() || !prefix.trim() || !baseUrl.trim()) return;
  setSubmitting(true);
  try {
    const url = isEdit ? `/api/provider-nodes/${nodeId}` : "/api/provider-nodes";
    const payload: Record<string, unknown> = { name, prefix, baseUrl };
    if (!isEdit) payload.type = "custom-embedding";
    const res = await fetch(url, { method: isEdit ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (res.ok) { if (isEdit) onSaved?.(data.node); else onCreated?.(data.node); }
  } catch (e) { console.error("Error saving custom embedding node:", e);
  } finally { setSubmitting(false); }
}

export async function validateEmbeddingEndpoint(
  baseUrl: string, apiKey: string, modelId: string,
  setValidationResult: (v: ValidationResult | null) => void,
  setValidating: (v: boolean) => void,
) {
  setValidating(true);
  try {
    const res = await fetch("/api/provider-nodes/validate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl, apiKey, type: "custom-embedding", modelId: modelId.trim() || undefined }),
    });
    setValidationResult(await res.json());
  } catch { setValidationResult({ valid: false, error: "Network error" });
  } finally { setValidating(false); }
}

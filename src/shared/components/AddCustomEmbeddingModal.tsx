"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input, Button } from "@/shared/components";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { translate } from "@/i18n/runtime";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

interface EmbeddingNode {
  id: string;
  name?: string;
  prefix?: string;
  baseUrl?: string;
}

interface AddCustomEmbeddingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (node: EmbeddingNode) => void;
  onSaved?: (node: EmbeddingNode) => void;
  node?: EmbeddingNode | null;
}

interface ValidationResult {
  valid?: boolean;
  error?: string;
  dimensions?: number;
}

// Dual-mode modal: edit when `node` provided, add otherwise
export default function AddCustomEmbeddingModal({ isOpen, onClose, onCreated, onSaved, node }: AddCustomEmbeddingModalProps) {
  const isEdit = !!node;
  const [formData, setFormData] = useState({
    name: "",
    prefix: "",
    baseUrl: DEFAULT_BASE_URL,
  });
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [checkKey, setCheckKey] = useState<string>("");
  const [checkModelId, setCheckModelId] = useState<string>("");
  const [validating, setValidating] = useState<boolean>(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setValidationResult(null);
    setCheckKey("");
    setCheckModelId("");
    if (isEdit && node) {
      setFormData({
        name: node.name || "",
        prefix: node.prefix || "",
        baseUrl: node.baseUrl || DEFAULT_BASE_URL,
      });
    } else {
      setFormData({ name: "", prefix: "", baseUrl: DEFAULT_BASE_URL });
    }
  }, [isOpen, isEdit, node]);

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
    setSubmitting(true);
    try {
      const url = isEdit ? `/api/provider-nodes/${node!.id}` : "/api/provider-nodes";
      const method = isEdit ? "PUT" : "POST";
      const payload: Record<string, unknown> = {
        name: formData.name,
        prefix: formData.prefix,
        baseUrl: formData.baseUrl,
      };
      if (!isEdit) payload.type = "custom-embedding";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        if (isEdit) onSaved?.(data.node);
        else onCreated?.(data.node);
      }
    } catch (error) {
      console.error("Error saving custom embedding node:", error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch("/api/provider-nodes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: formData.baseUrl,
          apiKey: checkKey,
          type: "custom-embedding",
          modelId: checkModelId.trim() || undefined,
        }),
      });
      const data = await res.json();
      setValidationResult(data);
    } catch {
      setValidationResult({ valid: false, error: "Network error" });
    } finally {
      setValidating(false);
    }
  };

  const renderValidationResult = () => {
    if (!validationResult) return null;
    const { valid, error, dimensions } = validationResult;
    if (valid) {
      return (
        <>
          <Badge variant="default" className="bg-green-500/10 text-green-600 dark:text-green-400">{translate("Valid") || "Valid"}</Badge>
          {dimensions && <span className="text-sm text-text-muted">{dimensions} {translate("Dimensions") || "Dimensions"}</span>}
        </>
      );
    }
    return (
      <div className="flex flex-col gap-1">
        <Badge variant="destructive">{translate("Invalid") || "Invalid"}</Badge>
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "bg-surface border border-border-subtle rounded-[14px]",
          "shadow-[var(--shadow-elev)] ring-0 gap-0 p-0",
          "max-w-md"
        )}
      >
        <div className="flex items-center justify-between p-2 border-b border-border-subtle">
          <DialogTitle className="text-lg font-semibold text-text-main ml-2">
            {isEdit ? translate("Edit Custom Embedding") || "Edit Custom Embedding" : translate("Add Custom Embedding") || "Add Custom Embedding"}
          </DialogTitle>
          <Button onClick={onClose} aria-label={translate("Close") || "Close"} variant="ghost" className="p-1.5">
            <X className="size-5" />
          </Button>
        </div>
        <div className="p-6 max-h-[calc(85vh-100px)] overflow-y-auto custom-scrollbar">
          <div className="flex flex-col gap-4">
        <Input
          label={translate("Name") || "Name"}
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="Voyage AI"
          hint={translate("Required. A friendly name for this embedding provider.") || "Required. A friendly name for this embedding provider."}
        />
        <Input
          label={translate("Prefix") || "Prefix"}
          value={formData.prefix}
          onChange={(e) => setFormData({ ...formData, prefix: e.target.value })}
          placeholder="voyage"
          hint={translate("Required. Used as provider prefix for model IDs (e.g. voyage/voyage-3).") || "Required. Used as provider prefix for model IDs (e.g. voyage/voyage-3)."}
        />
        <Input
          label={translate("Base URL") || "Base URL"}
          value={formData.baseUrl}
          onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
          placeholder="https://api.voyageai.com/v1"
          hint={translate("Most embedding APIs are OpenAI-compatible: Voyage, Cohere, Jina, Mistral, Together...") || "Most embedding APIs are OpenAI-compatible: Voyage, Cohere, Jina, Mistral, Together..."}
        />
        <Input
          label={translate("API Key (for Check)") || "API Key (for Check)"}
          type="password"
          value={checkKey}
          onChange={(e) => setCheckKey(e.target.value)}
        />
        <Input
          label={translate("Model ID (for Check)") || "Model ID (for Check)"}
          value={checkModelId}
          onChange={(e) => setCheckModelId(e.target.value)}
          placeholder="ex: voyage-3, embed-english-v3.0, text-embedding-3-small"
          hint={translate("Required for validation. Will send a test embeddings request.") || "Required for validation. Will send a test embeddings request."}
        />
        <div className="flex items-center gap-3">
          <Button
            onClick={handleValidate}
            disabled={!checkKey || !checkModelId.trim() || validating || !formData.baseUrl.trim()}
            variant="secondary"
          >
            {validating ? translate("Verifying...") || "Verifying..." : translate("Verify") || "Verify"}
          </Button>
          {renderValidationResult()}
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleSubmit}
            fullWidth
            disabled={!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim() || submitting}
          >
            {submitting ? (isEdit ? translate("Saving...") || "Saving..." : translate("Creating...") || "Creating...") : (isEdit ? translate("Save") || "Save" : translate("Create") || "Create")}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>{translate("Cancel") || "Cancel"}</Button>
          </div>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

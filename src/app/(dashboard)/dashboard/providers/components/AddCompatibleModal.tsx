"use client";

import { useState, useEffect } from "react";
import { Button, Input, Modal, Select } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import ValidationBadge from "./ValidationBadge";

type Variant = "openai" | "anthropic";

interface VariantConfig {
  title: string;
  type: string;
  defaultBaseUrl: string;
  namePlaceholder: string;
  prefixPlaceholder: string;
  baseUrlHint: string;
  modelIdPlaceholder: string;
  errorLabel: string;
  hasApiType: boolean;
}

const VARIANT_CONFIG: Record<Variant, VariantConfig> = {
  openai: {
    title: "Add OpenAI Compatible", type: "openai-compatible",
    defaultBaseUrl: "https://api.openai.com/v1", namePlaceholder: "OpenAI Compatible (Prod)",
    prefixPlaceholder: "oc-prod", baseUrlHint: "Use the base URL (ending in /v1) for your OpenAI-compatible API.",
    modelIdPlaceholder: "e.g. gpt-4, claude-3-opus", errorLabel: "OpenAI Compatible", hasApiType: true,
  },
  anthropic: {
    title: "Add Anthropic Compatible", type: "anthropic-compatible",
    defaultBaseUrl: "https://api.anthropic.com/v1", namePlaceholder: "Anthropic Compatible (Prod)",
    prefixPlaceholder: "ac-prod", baseUrlHint: "Use the base URL (ending in /v1) for your Anthropic-compatible API. The system will append /messages.",
    modelIdPlaceholder: "e.g. claude-3-opus", errorLabel: "Anthropic Compatible", hasApiType: false,
  },
};

const API_TYPE_OPTIONS = [
  { value: "chat", label: "Chat Completions" },
  { value: "responses", label: "Responses API" },
];

interface ProviderNode {
  id?: string; name?: string; prefix?: string; apiType?: string; baseUrl?: string; type?: string;
}

interface AddCompatibleModalProps {
  variant: Variant;
  isOpen: boolean;
  onClose: () => void;
  onCreated: (node: ProviderNode) => void;
}

export default function AddCompatibleModal({ variant, isOpen, onClose, onCreated }: AddCompatibleModalProps) {
  const config = VARIANT_CONFIG[variant];
  const initialFormData = () => ({
    name: "", prefix: "",
    ...(config.hasApiType ? { apiType: "chat" } : {}),
    baseUrl: config.defaultBaseUrl,
  });

  const [formData, setFormData] = useState<Record<string, string>>(initialFormData);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [checkKey, setCheckKey] = useState<string>("");
  const [checkModelId, setCheckModelId] = useState<string>("");
  const [validating, setValidating] = useState<boolean>(false);
  const [validationResult, setValidationResult] = useState<{ valid: boolean; error?: string; method?: string } | null>(null);

  useEffect(() => {
    if (config.hasApiType) setFormData((prev) => ({ ...prev, baseUrl: config.defaultBaseUrl }));
    else if (isOpen) { setValidationResult(null); setCheckKey(""); setCheckModelId(""); }
  }, [config, isOpen]);

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/provider-nodes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: formData.name, prefix: formData.prefix, ...(config.hasApiType ? { apiType: formData.apiType } : {}), baseUrl: formData.baseUrl, type: config.type }),
      });
      const data = await res.json();
      if (res.ok) { onCreated(data.node); setFormData(initialFormData()); setCheckKey(""); setValidationResult(null); }
    } catch { console.error(`Error creating ${config.errorLabel} node`); }
    finally { setSubmitting(false); }
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch("/api/provider-nodes/validate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: formData.baseUrl, apiKey: checkKey, type: config.type, modelId: checkModelId.trim() || undefined }),
      });
      setValidationResult(await res.json());
    } catch { setValidationResult({ valid: false, error: "Network error" }); }
    finally { setValidating(false); }
  };

  return (
    <Modal isOpen={isOpen} title={translate(config.title) || config.title} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input label="Name" value={formData.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, name: e.target.value })} placeholder={config.namePlaceholder} hint={translate("Required. A friendly label for this node.") || "Required. A friendly label for this node."} />
        <Input label="Prefix" value={formData.prefix} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, prefix: e.target.value })} placeholder={config.prefixPlaceholder} hint={translate("Required. Used as the provider prefix for model IDs.") || "Required. Used as the provider prefix for model IDs."} />
        {config.hasApiType && <Select label="API Type" options={API_TYPE_OPTIONS} value={formData.apiType} onChange={(value: string) => setFormData({ ...formData, apiType: value })} />}
        <Input label="Base URL" value={formData.baseUrl} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, baseUrl: e.target.value })} placeholder={config.defaultBaseUrl} hint={translate(config.baseUrlHint) || config.baseUrlHint} />
        <Input label={translate("API Key (for Check)") || "API Key (for Check)"} type="password" value={checkKey} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCheckKey(e.target.value)} />
        <Input label={translate("Model ID (optional)") || "Model ID (optional)"} value={checkModelId} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCheckModelId(e.target.value)} placeholder={config.modelIdPlaceholder} hint={translate("If provider lacks /models endpoint, enter a model ID to validate via chat/completions instead.") || "If provider lacks /models endpoint, enter a model ID to validate via chat/completions instead."} />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button onClick={handleValidate} disabled={!checkKey || validating || !formData.baseUrl.trim()} variant="secondary" className="w-full sm:w-auto">
            {validating ? translate("Checking...") : translate("Check")}
          </Button>
          <ValidationBadge result={validationResult} />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={handleSubmit} fullWidth disabled={!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim() || submitting}>
            {submitting ? translate("Creating...") : translate("Create")}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

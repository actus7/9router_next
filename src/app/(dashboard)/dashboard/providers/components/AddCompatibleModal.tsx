"use client";

import { useState, useEffect } from "react";
import { Button, Input, Modal, Select } from "@/shared/components";
import { Badge } from "@/components/ui/badge";

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
    title: "Adicionar Compatível OpenAI",
    type: "openai-compatible",
    defaultBaseUrl: "https://api.openai.com/v1",
    namePlaceholder: "Compatível OpenAI (Prod)",
    prefixPlaceholder: "oc-prod",
    baseUrlHint: "Use a URL base (terminando em /v1) para sua API compatível com OpenAI.",
    modelIdPlaceholder: "e.g. gpt-4, claude-3-opus",
    errorLabel: "Compatível OpenAI",
    hasApiType: true,
  },
  anthropic: {
    title: "Adicionar Compatível Anthropic",
    type: "anthropic-compatible",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    namePlaceholder: "Compatível Anthropic (Prod)",
    prefixPlaceholder: "ac-prod",
    baseUrlHint: "Use a URL base (terminando em /v1) para sua API compatível com Anthropic. O sistema adicionará /messages.",
    modelIdPlaceholder: "e.g. claude-3-opus",
    errorLabel: "Compatível Anthropic",
    hasApiType: false,
  },
};

const API_TYPE_OPTIONS = [
  { value: "chat", label: "Chat Completions" },
  { value: "responses", label: "Responses API" },
];

interface ProviderNode {
  id?: string;
  name?: string;
  prefix?: string;
  apiType?: string;
  baseUrl?: string;
  type?: string;
}

interface AddCompatibleModalProps {
  variant: Variant;
  isOpen: boolean;
  onClose: () => void;
  onCreated: (node: ProviderNode) => void;
}

function AddCompatibleModal({ variant, isOpen, onClose, onCreated }: AddCompatibleModalProps) {
  const config = VARIANT_CONFIG[variant];
  const initialFormData = () => ({
    name: "",
    prefix: "",
    ...(config.hasApiType ? { apiType: "chat" } : {}),
    baseUrl: config.defaultBaseUrl,
  });

  const [formData, setFormData] = useState<Record<string, string>>(initialFormData);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [checkKey, setCheckKey] = useState<string>("");
  const [checkModelId, setCheckModelId] = useState<string>("");
  const [validating, setValidating] = useState<boolean>(false);
  const [validationResult, setValidationResult] = useState<{ valid: boolean; error?: string; method?: string } | null>(null);

  // openai: reset baseUrl when apiType changes; anthropic: reset checks when opened
  useEffect(() => {
    if (config.hasApiType) {
      setFormData((prev) => ({ ...prev, baseUrl: config.defaultBaseUrl }));
    } else if (isOpen) {
      setValidationResult(null);
      setCheckKey("");
      setCheckModelId("");
    }
  }, [config.hasApiType ? formData.apiType : isOpen, config]);

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/provider-nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          prefix: formData.prefix,
          ...(config.hasApiType ? { apiType: formData.apiType } : {}),
          baseUrl: formData.baseUrl,
          type: config.type,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        onCreated(data.node);
        setFormData(initialFormData());
        setCheckKey("");
        setValidationResult(null);
      }
    } catch { console.error(`Error creating ${config.errorLabel} node`);
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
          type: config.type,
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
    const { valid, error, method } = validationResult;
    if (valid) {
      return (
        <>
          <Badge variant="default" className="bg-green-500/10 text-green-600 dark:text-green-400">Valid</Badge>
          {method === "chat" && (
            <span className="text-sm text-text-muted">(via inference test)</span>
          )}
        </>
      );
    }
    return (
      <div className="flex flex-col gap-1">
        <Badge variant="destructive">Invalid</Badge>
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>
    );
  };

  return (
    <Modal isOpen={isOpen} title={config.title} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={formData.name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, name: e.target.value })}
          placeholder={config.namePlaceholder}
          hint="Obrigatório. Um rótulo amigável para este nó."
        />
        <Input
          label="Prefix"
          value={formData.prefix}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, prefix: e.target.value })}
          placeholder={config.prefixPlaceholder}
          hint="Obrigatório. Usado como prefixo do provedor para IDs de modelos."
        />
        {config.hasApiType && (
          <Select
            label="API Type"
            options={API_TYPE_OPTIONS}
            value={formData.apiType}
            onChange={(value: string) => setFormData({ ...formData, apiType: value })}
          />
        )}
        <Input
          label="Base URL"
          value={formData.baseUrl}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, baseUrl: e.target.value })}
          placeholder={config.defaultBaseUrl}
          hint={config.baseUrlHint}
        />
        <Input
          label="Chave de API (para Verificação)"
          type="password"
          value={checkKey}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCheckKey(e.target.value)}
        />
        <Input
          label="ID do Modelo (opcional)"
          value={checkModelId}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCheckModelId(e.target.value)}
          placeholder={config.modelIdPlaceholder}
          hint="Se o provedor não tem endpoint /models, insira um ID de modelo para validar via chat/completions."
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            onClick={handleValidate}
            disabled={!checkKey || validating || !formData.baseUrl.trim()}
            variant="secondary"
            className="w-full sm:w-auto"
          >
            {validating ? "Verificando..." : "Verificar"}
          </Button>
          {renderValidationResult()}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            onClick={handleSubmit}
            fullWidth
            disabled={
              !formData.name.trim() ||
              !formData.prefix.trim() ||
              !formData.baseUrl.trim() ||
              submitting
            }
          >
            {submitting ? "Criando..." : "Criar"}
          </Button>
          <Button onClick={onClose} variant="ghost" fullWidth>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default AddCompatibleModal;

"use client";

import { useState } from "react";
import { Card, ModelSelectModal, ActiveProvider } from "@/shared/components";
import Button from "@/shared/components/Button";
import { getProviderIconSrc, markProviderIconMissing } from "@/shared/utils/providerIcon";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import Image from "next/image";
import { ChevronDown } from "lucide-react";
import { GuideSteps } from "./GuideSteps";

interface ApiKey { id: string; key: string; }
interface ToolInfo {
  name: string;
  description?: string;
  image?: string;
  icon?: string;
  color?: string;
  requiresExternalUrl?: boolean;
  requiresCloud?: boolean;
  notes?: Array<{ type: string; text: string }>;
  guideSteps?: Array<{ step: number; title: string; desc?: string; type?: string; value?: string; copyable?: boolean }>;
  codeBlock?: { language: string; code: string };
}
interface StatusData { installed?: boolean; hasModelHub?: boolean; }

interface DefaultToolCardProps {
  toolId: string;
  tool: ToolInfo;
  isExpanded: boolean;
  onToggle: () => void;
  baseUrl: string;
  apiKeys: ApiKey[];
  activeProviders?: ActiveProvider[];
  cloudEnabled?: boolean;
  tunnelEnabled?: boolean;
}

export default function DefaultToolCard({ toolId, tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders = [], cloudEnabled = false, tunnelEnabled = false }: DefaultToolCardProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showModelModal, setShowModelModal] = useState<boolean>(false);
  const [modelValue, setModelValue] = useState<string>("");

  const [selectedApiKey, setSelectedApiKey] = useState<string>(() =>
    apiKeys?.length > 0 ? apiKeys[0].key : ""
  );

  const replaceVars = (text: string): string => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_modelhub" : "your-api-key");

    const normalizedBaseUrl = baseUrl || "http://localhost:20128";
    const baseUrlWithV1 = normalizedBaseUrl.endsWith("/v1")
      ? normalizedBaseUrl
      : `${normalizedBaseUrl}/v1`;

    return text
      .replace(/\{\{baseUrl\}\}/g, baseUrlWithV1)
      .replace(/\{\{apiKey\}\}/g, keyToUse)
      .replace(/\{\{model\}\}/g, modelValue || "provider/model-id");
  };

  const { copy: copyToClipboard } = useCopyToClipboard();

  const handleCopy = async (text: string, field: string) => {
    await copyToClipboard(replaceVars(text), `toolcard-${field}`);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleSelectModel = (model: { value: string }) => {
    setModelValue(model.value);
  };

  const hasActiveProviders = activeProviders.length > 0;

  const renderIcon = () => {
    if (tool.image) {
      return (
        <Image
          src={tool.image}
          alt={tool.name}
          width={32}
          height={32}
          className="size-8 object-contain rounded-lg"
          sizes="32px"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        loading="lazy"
        decoding="async"
        />
      );
    }
    if (tool.icon) {
      return <span className="text-xl" style={{ color: tool.color }}>{tool.icon}</span>;
    }
    const iconSrc = getProviderIconSrc(toolId);
    if (!iconSrc) {
      return <span className="text-xs font-bold" style={{ color: tool.color }}>{(toolId || "?").slice(0, 2).toUpperCase()}</span>;
    }
    return (
      <Image
        src={iconSrc}
        alt={tool.name}
        width={32}
        height={32}
        className="size-8 object-contain rounded-lg"
        sizes="32px"
        onError={(e) => {
          markProviderIconMissing(toolId);
          (e.target as HTMLImageElement).style.display = "none";
        }}
      loading="lazy"
      decoding="async"
      />
    );
  };

  return (
    <Card padding="xs" className="overflow-hidden overflow-x-hidden">
      <div className="flex items-center justify-between hover:cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-lg flex items-center justify-center shrink-0">
            {renderIcon()}
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-sm">{tool.name}</h3>
            <p className="text-xs text-text-muted truncate">{tool.description}</p>
          </div>
        </div>
        <ChevronDown className={`size-5 text-text-muted transition-transform ${isExpanded ? "rotate-180" : ""}`} />
      </div>

      {isExpanded && (
        <div className="mt-6 pt-6 border-t border-border">
          <GuideSteps
            guideSteps={tool.guideSteps || []}
            notes={tool.notes}
            codeBlock={tool.codeBlock}
            color={tool.color}
            cloudEnabled={cloudEnabled}
            tunnelEnabled={tunnelEnabled}
            requiresExternalUrl={tool.requiresExternalUrl}
            requiresCloud={tool.requiresCloud}
            apiKeys={apiKeys}
            selectedApiKey={selectedApiKey}
            onApiKeyChange={setSelectedApiKey}
            modelValue={modelValue}
            onModelChange={setModelValue}
            onOpenModelModal={() => setShowModelModal(true)}
            hasActiveProviders={hasActiveProviders}
            copiedField={copiedField}
            onCopy={handleCopy}
            replaceVars={replaceVars}
          />
        </div>
      )}

      {showModelModal && (
        <ModelSelectModal
          isOpen={showModelModal}
          onClose={() => setShowModelModal(false)}
          onSelect={handleSelectModel}
          selectedModel={modelValue}
          activeProviders={activeProviders}
          title="Select Model"
        />
      )}
    </Card>
  );
}

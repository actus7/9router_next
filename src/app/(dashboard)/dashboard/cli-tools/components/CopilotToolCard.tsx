"use client";

import { useState, useEffect, useRef } from "react";
import { Card, ModelSelectModal, ActiveProvider, ManualConfigModal } from "@/shared/components";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";
import { useModelAliases } from "./useCliToolCommon";
import { StatusMessage, ActionButtons } from "./CliToolShared";
import { ArrowRight, ChevronDown, Info, Loader2, X } from "lucide-react";

interface ApiKey { id: string; key: string; }
interface ToolInfo { name: string; description?: string; requiresExternalUrl?: boolean; }
interface StatusData { installed?: boolean; hasModelHub?: boolean; currentUrl?: string; config?: Array<{ name: string; models?: Array<{ id: string }> }>; error?: string; settings?: { model?: { base_url?: string; default?: string; }; }; }
interface Message { type: "success" | "error"; text: string; }

interface CopilotToolCardProps {
  tool: ToolInfo;
  isExpanded: boolean;
  onToggle: () => void;
  baseUrl: string;
  apiKeys: ApiKey[];
  activeProviders: ActiveProvider[];
  cloudEnabled: boolean;
  initialStatus?: StatusData | null;
  tunnelEnabled: boolean;
  tunnelPublicUrl: string;
  tailscaleEnabled: boolean;
  tailscaleUrl: string;
}

export default function CopilotToolCard({ tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders, cloudEnabled, initialStatus, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl }: CopilotToolCardProps) {
  const [status, setStatus] = useState<StatusData | null>(initialStatus || null);
  const [checking, setChecking] = useState<boolean>(false);
  const [applying, setApplying] = useState<boolean>(false);
  const [restoring, setRestoring] = useState<boolean>(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [selectedApiKey, setSelectedApiKey] = useState<string>("");
  const [customBaseUrl, setCustomBaseUrl] = useState<string>("");
  const [showManualConfigModal, setShowManualConfigModal] = useState<boolean>(false);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const selectedModelsRef = useRef<string[]>([]);
  const { modelAliases, fetchModelAliases } = useModelAliases();

  useEffect(() => {
    selectedModelsRef.current = selectedModels;
  }, [selectedModels]);

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) setSelectedApiKey(apiKeys[0].key);
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (initialStatus) setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (isExpanded) {
      if (!status) checkStatus();
      fetchModelAliases();
    }
  }, [fetchModelAliases, isExpanded, status]);

  useEffect(() => {
    if (status?.config && Array.isArray(status.config) && selectedModels.length === 0) {
      const entry = status.config.find((e: { name: string }) => e.name === "ModelHub");
      if (entry?.models && entry.models.length > 0) {
        setSelectedModels(entry.models.map((m: { id: string }) => m.id));
      }
    }
  }, [selectedModels.length, status]);

  const saveModels = async (models: string[]) => {
    try {
      const keyToUse = (selectedApiKey && selectedApiKey.trim())
        ? selectedApiKey
        : (!cloudEnabled ? "sk_modelhub" : selectedApiKey);
      await fetch("/api/cli-tools/copilot-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: getEffectiveBaseUrl(), apiKey: keyToUse, models }),
      });
    } catch (error) {
      console.error("Error saving models:", error);
    }
  };

  const getConfigStatus = () => {
    if (!status) return null;
    if (!status.hasModelHub) return "not_configured";
    const url = status.currentUrl || "";
    return matchKnownEndpoint(url, { tunnelPublicUrl, tailscaleUrl }) ? "configured" : "other";
  };

  const configStatus = getConfigStatus();

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || baseUrl;
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getDisplayUrl = () => customBaseUrl || `${baseUrl}/v1`;

  const removeModel = (id: string) => setSelectedModels((prev) => prev.filter((m) => m !== id));

  const checkStatus = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/cli-tools/copilot-settings");
      const data = await res.json();
      setStatus(data);
    } catch (error) {
      setStatus({ error: (error as Error).message });
    } finally {
      setChecking(false);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const keyToUse = (selectedApiKey && selectedApiKey.trim())
        ? selectedApiKey
        : (!cloudEnabled ? "sk_modelhub" : selectedApiKey);

      const res = await fetch("/api/cli-tools/copilot-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: getEffectiveBaseUrl(), apiKey: keyToUse, models: selectedModels }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: data.message || "Settings applied! Reload VS Code." });
        checkStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to apply settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: (error as Error).message });
    } finally {
      setApplying(false);
    }
  };

  const handleReset = async () => {
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cli-tools/copilot-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setSelectedModels([]);
        checkStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: (error as Error).message });
    } finally {
      setRestoring(false);
    }
  };

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_modelhub" : "<API_KEY_FROM_DASHBOARD>");
    const effectiveBaseUrl = getEffectiveBaseUrl();
    const modelsToShow = selectedModels.length > 0 ? selectedModels : ["provider/model-id"];

    return [{
      filename: "~/Library/Application Support/Code/User/chatLanguageModels.json",
      content: JSON.stringify([{
        name: "ModelHub",
        vendor: "azure",
        apiKey: keyToUse,
        models: modelsToShow.map((id) => ({
          id, name: id,
          url: `${effectiveBaseUrl}/chat/completions#models.ai.azure.com`,
          toolCalling: true, vision: false,
          maxInputTokens: 128000, maxOutputTokens: 16000,
        })),
      }], null, 2),
    }];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src="/providers/copilot.png" alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} loading="lazy" decoding="async" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="font-medium text-sm">{tool.name}</h3>
              {configStatus === "configured" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-500/10 text-green-600 dark:text-green-400 rounded-full">Connected</span>}
              {configStatus === "not_configured" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-full">Not configured</span>}
              {configStatus === "other" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full">Other</span>}
            </div>
            <p className="text-xs text-text-muted truncate">{tool.description}</p>
          </div>
        </div>
        <ChevronDown className={`size-5 text-text-muted transition-transform ${isExpanded ? "rotate-180" : ""}`} />
      </div>

      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-border flex flex-col gap-4">
          {checking && (
            <div className="flex items-center gap-2 text-text-muted">
              <Loader2 className="size-4" />
              <span>Checking Copilot config...</span>
            </div>
          )}

          {!checking && (
            <>
              <div className="flex items-start gap-3 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                <Info className="size-4" />
                <div className="text-xs text-blue-700 dark:text-blue-300">
                  <p className="font-medium">Writes to <code className="px-1 bg-black/5 dark:bg-white/10 rounded">chatLanguageModels.json</code></p>
                  <p className="mt-0.5 opacity-80">Reload VS Code after applying for changes to take effect.</p>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Select Endpoint</span>
                  <ArrowRight className="size-4" />
                  <BaseUrlSelect value={customBaseUrl || getDisplayUrl()} onChange={setCustomBaseUrl} requiresExternalUrl={tool.requiresExternalUrl} tunnelEnabled={tunnelEnabled} tunnelPublicUrl={tunnelPublicUrl} tailscaleEnabled={tailscaleEnabled} tailscaleUrl={tailscaleUrl} />
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">API Key</span>
                  <ArrowRight className="size-4" />
                  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
                  <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right pt-1">Models</span>
                  <ArrowRight className="size-4" />
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="flex flex-wrap gap-1.5 min-h-[28px] px-2 py-1.5 bg-surface rounded border border-border">
                      {selectedModels.length === 0 ? (
                        <span className="text-xs text-text-muted">No models selected</span>
                      ) : (
                        selectedModels.map((model) => (
                          <span key={model} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-black/5 dark:bg-white/5 text-text-muted border border-transparent hover:border-border">
                            {model}
                            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); removeModel(model); }} className="ml-0.5 hover:text-red-500 p-0 h-auto">
                              <X className="size-3" />
                            </Button>
                          </span>
                        ))
                      )}
                    </div>
                    <div>
                      <Button variant="outline" size="sm" onClick={() => setModalOpen(true)} disabled={!activeProviders?.length}>Add Model</Button>
                    </div>
                  </div>
                </div>
              </div>

              <StatusMessage message={message} />

              <ActionButtons
                onApply={handleApply}
                applyDisabled={selectedModels.length === 0}
                applyLoading={applying}
                onReset={handleReset}
                resetDisabled={!status?.hasModelHub}
                resetLoading={restoring}
                onManualConfig={() => setShowManualConfigModal(true)}
              />
            </>
          )}
        </div>
      )}

      {modalOpen && (
        <ModelSelectModal
          isOpen={modalOpen}
          onClose={() => {
            setModalOpen(false);
            saveModels(selectedModelsRef.current);
          }}
          onSelect={(model: { value: string }) => {
            if (!selectedModels.includes(model.value)) {
              setSelectedModels([...selectedModels, model.value]);
            }
          }}
          onDeselect={(model: { value: string }) => {
            setSelectedModels(selectedModels.filter(m => m !== model.value));
          }}
          selectedModel={undefined}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          addedModelValues={selectedModels}
          closeOnSelect={false}
          title="Add Model for GitHub Copilot"
        />
      )}

      <ManualConfigModal isOpen={showManualConfigModal} onClose={() => setShowManualConfigModal(false)} title="GitHub Copilot - Manual Configuration" configs={getManualConfigs()} />
    </Card>
  );
}

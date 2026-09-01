"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button, ModelSelectModal, ActiveProvider, ManualConfigModal } from "@/shared/components";
import { Input } from "@/components/ui/input";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";
import { useModelAliases } from "./useCliToolCommon";
import { StatusMessage, ActionButtons } from "./CliToolShared";
import { ModelTagList } from "./ModelTagList";
import { ArrowRight, ChevronDown, ChevronUp, Copy, Info, Loader2, TriangleAlert, X } from "lucide-react";

interface ApiKey { id: string; key: string; }
interface ToolInfo { name: string; description?: string; requiresExternalUrl?: boolean; }
interface StatusData { installed?: boolean; hasModelHub?: boolean; opencode?: { models?: string[]; activeModel?: string; }; config?: { agent?: { explorer?: { model?: string; }; }; provider?: { "modelhub"?: { options?: { baseURL?: string; }; }; }; }; settings?: { model?: { base_url?: string; default?: string; }; }; }
interface Message { type: "success" | "error"; text: string; }

interface OpenCodeToolCardProps {
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

export default function OpenCodeToolCard({ tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders, cloudEnabled, initialStatus, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl }: OpenCodeToolCardProps) {
  const [status, setStatus] = useState<StatusData | null>(initialStatus || null);
  const [checking, setChecking] = useState<boolean>(false);
  const [applying, setApplying] = useState<boolean>(false);
  const [restoring, setRestoring] = useState<boolean>(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [showInstallGuide, setShowInstallGuide] = useState<boolean>(false);
  const [selectedApiKey, setSelectedApiKey] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [subagentModel, setSubagentModel] = useState<string>("");
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [subagentModalOpen, setSubagentModalOpen] = useState<boolean>(false);
  const [showManualConfigModal, setShowManualConfigModal] = useState<boolean>(false);
  const [customBaseUrl, setCustomBaseUrl] = useState<string>("");
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [activeModel, setActiveModel] = useState<string>("");
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
    if (status?.opencode?.models) setSelectedModels(status.opencode.models);
    if (status?.opencode?.activeModel) setActiveModel(status.opencode.activeModel);
    if (status?.config?.agent?.explorer?.model?.startsWith("modelhub/")) {
      setSubagentModel(status.config.agent.explorer.model.replace("modelhub/", ""));
    }
  }, [status]);

  const saveModels = async (models: string[]) => {
    try {
      const keyToUse = (selectedApiKey && selectedApiKey.trim())
        ? selectedApiKey
        : (!cloudEnabled ? "sk_modelhub" : selectedApiKey);
      const validActiveModel = models.includes(activeModel) ? activeModel : (models[0] || "");
      await fetch("/api/cli-tools/opencode-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: getEffectiveBaseUrl(), apiKey: keyToUse, models, activeModel: validActiveModel, subagentModel }),
      });
    } catch (error) {
      console.error("Error saving models:", error);
    }
  };

  const getConfigStatus = () => {
    if (!status?.installed) return null;
    if (!status.config) return "not_configured";
    if (!status.hasModelHub) return "not_configured";
    const url = status.config?.provider?.["modelhub"]?.options?.baseURL || "";
    return matchKnownEndpoint(url, { tunnelPublicUrl, tailscaleUrl }) ? "configured" : "other";
  };

  const configStatus = getConfigStatus();

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || baseUrl;
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getDisplayUrl = () => customBaseUrl || `${baseUrl}/v1`;

  const checkStatus = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/cli-tools/opencode-settings");
      const data = await res.json();
      setStatus(data);
    } catch  {
      setStatus({ installed: false });
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

      const res = await fetch("/api/cli-tools/opencode-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          models: selectedModels,
          activeModel: activeModel === "" ? "" : (activeModel || selectedModels[0]),
          subagentModel: subagentModel
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings applied successfully!" });
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
      const res = await fetch("/api/cli-tools/opencode-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setSelectedModel("");
        setSubagentModel("");
        setSelectedModels([]);
        setActiveModel("");
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

  const handleToggleActive = async (model: string) => {
    if (model === activeModel) {
      try {
        const res = await fetch("/api/cli-tools/opencode-settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clearActiveModel: true }),
        });
        if (res.ok) {
          setActiveModel("");
          checkStatus();
        }
      } catch (error) {
        console.error("Error clearing active model:", error);
      }
    } else {
      setActiveModel(model);
    }
  };

  const handleRemoveModel = async (model: string) => {
    try {
      const res = await fetch(`/api/cli-tools/opencode-settings?model=${encodeURIComponent(model)}`, { method: "DELETE" });
      if (res.ok) {
        const newModels = selectedModels.filter((m) => m !== model);
        setSelectedModels(newModels);
        if (activeModel === model) setActiveModel("");
        checkStatus();
      }
    } catch (error) {
      console.error("Error removing model:", error);
    }
  };

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_modelhub" : "<API_KEY_FROM_DASHBOARD>");

    const modelsToShow = selectedModels.length > 0 ? selectedModels : ["provider/model-id"];
    const activeModelToShow = activeModel || selectedModels[0] || modelsToShow[0];
    const effectiveSubagentModel = subagentModel || activeModelToShow;

    const modelsObj: Record<string, { name: string; modalities: { input: string[]; output: string[] } }> = {};
    modelsToShow.forEach(m => {
      modelsObj[m] = { name: m, modalities: { input: ["text", "image"], output: ["text"] } };
    });

    return [{
      filename: "~/.config/opencode/opencode.json",
      content: JSON.stringify({
        provider: { "modelhub": { npm: "@ai-sdk/openai-compatible", options: { baseURL: getEffectiveBaseUrl(), apiKey: keyToUse }, models: modelsObj } },
        model: `modelhub/${activeModelToShow}`,
        agent: { explorer: { description: "Fast explorer subagent for codebase exploration", mode: "subagent", model: `modelhub/${effectiveSubagentModel}` } }
      }, null, 2),
    }];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src="/providers/opencode.png" alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} loading="lazy" decoding="async" />
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
              <span>Checking OpenCode CLI...</span>
            </div>
          )}

          {!checking && status && !status.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <TriangleAlert className="size-4" />
                  <div className="flex-1">
                    <p className="font-medium text-yellow-600 dark:text-yellow-400">OpenCode CLI not detected locally</p>
                    <p className="text-sm text-text-muted">Manual configuration is still available if modelhub is deployed on a remote server.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-9">
                  <Button variant="secondary" size="sm" onClick={() => setShowManualConfigModal(true)} className="!bg-yellow-500/20 !border-yellow-500/40 !text-yellow-700 dark:!text-yellow-300 hover:!bg-yellow-500/30">
                    <Copy className="size-5" />
                    Manual Config
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowInstallGuide(!showInstallGuide)}>
                    {showInstallGuide ? <ChevronUp className="size-4 mr-1" /> : <Info className="size-4 mr-1" />}
                    {showInstallGuide ? "Hide" : "How to Install"}
                  </Button>
                </div>
              </div>
              {showInstallGuide && (
                <div className="p-4 bg-surface border border-border rounded-lg">
                  <h4 className="font-medium mb-3">Installation Guide</h4>
                  <div className="space-y-3 text-sm">
                    <div>
                      <p className="text-text-muted mb-1">macOS / Linux:</p>
                      <code className="block px-3 py-2 bg-black/5 dark:bg-white/5 rounded font-mono text-xs">npm install -g opencode-ai</code>
                    </div>
                    <p className="text-text-muted">After installation, run <code className="px-1 bg-black/5 dark:bg-white/5 rounded">opencode</code> to verify.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {!checking && status?.installed && (
            <>
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Select Endpoint</span>
                  <ArrowRight className="size-4" />
                  <BaseUrlSelect value={customBaseUrl || getDisplayUrl()} onChange={setCustomBaseUrl} requiresExternalUrl={tool.requiresExternalUrl} tunnelEnabled={tunnelEnabled} tunnelPublicUrl={tunnelPublicUrl} tailscaleEnabled={tailscaleEnabled} tailscaleUrl={tailscaleUrl} />
                </div>

                {status?.config?.provider?.["modelhub"]?.options?.baseURL && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Current</span>
                    <ArrowRight className="size-4" />
                    <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">{status.config.provider["modelhub"].options.baseURL}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">API Key</span>
                  <ArrowRight className="size-4" />
                  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                <ModelTagList
                  selectedModels={selectedModels}
                  activeModel={activeModel}
                  onToggleActive={handleToggleActive}
                  onRemoveModel={handleRemoveModel}
                  onAddModel={() => setModalOpen(true)}
                  hasActiveProviders={!!activeProviders?.length}
                />

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Subagent Model</span>
                  <ArrowRight className="size-4" />
                  <Input type="text" value={subagentModel} onChange={(e) => setSubagentModel(e.target.value)} placeholder={selectedModel || "provider/model-id (defaults to main model)"} className="w-full min-w-0 px-2 py-2 text-xs sm:py-1.5" />
                  <Button variant="outline" size="sm" onClick={() => setSubagentModalOpen(true)} disabled={!activeProviders?.length} className="w-full sm:w-auto">
                    Select Model
                  </Button>
                  {subagentModel && (
                    <Button variant="ghost" size="sm" onClick={() => setSubagentModel("")} className="p-1 text-text-muted hover:text-red-500" title="Clear (will use main model)">
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
              </div>

              <StatusMessage message={message} />

              <ActionButtons
                onApply={handleApply}
                applyDisabled={selectedModels.length === 0}
                applyLoading={applying}
                onReset={handleReset}
                resetDisabled={!status.hasModelHub}
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
              if (!activeModel) setActiveModel(model.value);
            }
          }}
          onDeselect={(model: { value: string }) => {
            const remaining = selectedModels.filter(m => m !== model.value);
            setSelectedModels(remaining);
            if (activeModel === model.value) setActiveModel(remaining[0] || "");
          }}
          selectedModel={undefined}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          addedModelValues={selectedModels}
          closeOnSelect={false}
          title="Add Model for OpenCode"
        />
      )}

      {subagentModalOpen && (
        <ModelSelectModal isOpen={subagentModalOpen} onClose={() => setSubagentModalOpen(false)} onSelect={(model: { value: string }) => { setSubagentModel(model.value); setSubagentModalOpen(false); }} selectedModel={subagentModel} activeProviders={activeProviders} modelAliases={modelAliases} title="Select Subagent Model for OpenCode" />
      )}

      <ManualConfigModal isOpen={showManualConfigModal} onClose={() => setShowManualConfigModal(false)} title="OpenCode - Manual Configuration" configs={getManualConfigs()} />
    </Card>
  );
}

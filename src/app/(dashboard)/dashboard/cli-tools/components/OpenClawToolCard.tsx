"use client";

import { useState, useEffect, useRef } from "react";
import { ModelSelectModal, ActiveProvider, ManualConfigModal } from "@/shared/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";
import { ArrowRight, X } from "lucide-react";
import ToolCardShell from "./ToolCardShell";

interface ApiKey { id: string; key: string; }
interface ToolInfo { name: string; description?: string; requiresExternalUrl?: boolean; }
interface StatusData { installed?: boolean; hasModelHub?: boolean; settings?: { model?: { base_url?: string; default?: string; }; models?: { providers?: Record<string, { baseUrl?: string; apiKey?: string; }>; }; agents?: { defaults?: { model?: { primary?: string; }; }; }; }; agents?: Array<{ id: string; name?: string; agentDir?: string; currentModel?: string; }>; }
interface Message { type: "success" | "error"; text: string; }

interface OpenClawToolCardProps {
  tool: ToolInfo;
  isExpanded: boolean;
  onToggle: () => void;
  baseUrl: string;
  hasActiveProviders: boolean;
  apiKeys: ApiKey[];
  activeProviders: ActiveProvider[];
  cloudEnabled: boolean;
  initialStatus?: StatusData | null;
  tunnelEnabled: boolean;
  tunnelPublicUrl: string;
  tailscaleEnabled: boolean;
  tailscaleUrl: string;
}

export default function OpenClawToolCard({
  tool, isExpanded, onToggle, baseUrl: _baseUrl, hasActiveProviders, apiKeys, activeProviders, cloudEnabled, initialStatus,
  tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl,
}: OpenClawToolCardProps) {
  const [openclawStatus, setOpenclawStatus] = useState<StatusData | null>(initialStatus || null);
  const [checkingOpenclaw, setCheckingOpenclaw] = useState<boolean>(false);
  const [applying, setApplying] = useState<boolean>(false);
  const [restoring, setRestoring] = useState<boolean>(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [selectedApiKey, setSelectedApiKey] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [agentModels, setAgentModels] = useState<Record<string, string>>({});
  const [agentModalFor, setAgentModalFor] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [modelAliases, setModelAliases] = useState<Record<string, string>>({});
  const [showManualConfigModal, setShowManualConfigModal] = useState<boolean>(false);
  const [customBaseUrl, setCustomBaseUrl] = useState<string>("");
  const hasInitializedModel = useRef(false);

  const getConfigStatus = () => {
    if (!openclawStatus?.installed) return null;
    const currentProvider = openclawStatus.settings?.models?.providers?.["modelhub"];
    if (!currentProvider) return "not_configured";
    return matchKnownEndpoint(currentProvider.baseUrl || "", { tunnelPublicUrl, tailscaleUrl }) ? "configured" : "other";
  };

  const configStatus = getConfigStatus();

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) setSelectedApiKey(apiKeys[0].key);
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (initialStatus) setOpenclawStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (isExpanded) {
      if (!openclawStatus) checkOpenclawStatus();
      fetchModelAliases();
    }
  }, [isExpanded, openclawStatus]);

  const fetchModelAliases = async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch (error) {
      console.error("Error fetching model aliases:", error);
    }
  };

  useEffect(() => {
    if (openclawStatus?.installed && !hasInitializedModel.current) {
      hasInitializedModel.current = true;
      const provider = openclawStatus.settings?.models?.providers?.["modelhub"];
      if (provider) {
        const primaryModel = openclawStatus.settings?.agents?.defaults?.model?.primary;
        if (primaryModel) setSelectedModel(primaryModel.replace("modelhub/", ""));
        if (provider.apiKey && apiKeys?.some(k => k.key === provider.apiKey)) {
          setSelectedApiKey(provider.apiKey);
        }
      }
      const agentList = openclawStatus.agents || [];
      const initAgentModels: Record<string, string> = {};
      agentList.forEach((agent: { id: string; currentModel?: string }) => {
        if (agent.currentModel) initAgentModels[agent.id] = agent.currentModel;
      });
      setAgentModels(initAgentModels);
    }
  }, [openclawStatus, apiKeys]);

  const checkOpenclawStatus = async () => {
    setCheckingOpenclaw(true);
    try {
      const res = await fetch("/api/cli-tools/openclaw-settings");
      const data = await res.json();
      setOpenclawStatus(data);
    } catch  {
      setOpenclawStatus({ installed: false });
    } finally {
      setCheckingOpenclaw(false);
    }
  };

  const normalizeLocalhost = (url: string) => url.replace("://localhost", "://127.0.0.1");

  const getLocalBaseUrl = () => {
    if (typeof window !== "undefined") return normalizeLocalhost(window.location.origin);
    return "http://127.0.0.1:20128";
  };

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || getLocalBaseUrl();
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getDisplayUrl = () => {
    const url = customBaseUrl || getLocalBaseUrl();
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const handleApplySettings = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const keyToUse = selectedApiKey?.trim()
        || (apiKeys?.length > 0 ? apiKeys[0].key : null)
        || (!cloudEnabled ? "sk_modelhub" : null);

      const res = await fetch("/api/cli-tools/openclaw-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: getEffectiveBaseUrl(), apiKey: keyToUse, model: selectedModel, agentModels }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings applied successfully!" });
        checkOpenclawStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to apply settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: (error as Error).message });
    } finally {
      setApplying(false);
    }
  };

  const handleResetSettings = async () => {
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cli-tools/openclaw-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setSelectedModel("");
        setSelectedApiKey("");
        checkOpenclawStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: (error as Error).message });
    } finally {
      setRestoring(false);
    }
  };

  const handleModelSelect = (model: { value: string }) => {
    if (agentModalFor) {
      setAgentModels(prev => ({ ...prev, [agentModalFor]: model.value }));
      setAgentModalFor(null);
    } else {
      setSelectedModel(model.value);
    }
    setModalOpen(false);
  };

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_modelhub" : "<API_KEY_FROM_DASHBOARD>");

    const settingsContent = {
      agents: { defaults: { model: { primary: `modelhub/${selectedModel || "provider/model-id"}` } } },
      models: { providers: { "modelhub": { baseUrl: getEffectiveBaseUrl(), apiKey: keyToUse, api: "openai-completions", models: [{ id: selectedModel || "provider/model-id", name: (selectedModel || "provider/model-id").split("/").pop() }] } } },
    };

    return [{ filename: "~/.openclaw/openclaw.json", content: JSON.stringify(settingsContent, null, 2) }];
  };

  return (
    <>
      <ToolCardShell
        iconSrc="/providers/openclaw.png"
        toolName={tool.name}
        toolDescription={tool.description}
        configStatus={configStatus}
        isExpanded={isExpanded}
        onToggle={onToggle}
        checking={checkingOpenclaw}
        checkingLabel="Checking Open Claw CLI..."
        installed={openclawStatus?.installed}
        notInstalledMessage="Open Claw CLI not detected locally"
        notInstalledDetail="Manual configuration is still available if modelhub is deployed on a remote server."
        message={message}
        capabilities={{
          manualConfig: { execute: () => setShowManualConfigModal(true) },
          apply: { execute: handleApplySettings, disabled: !selectedModel, loading: applying },
          reset: { execute: handleResetSettings, disabled: !openclawStatus?.hasModelHub, loading: restoring },
        }}
      >
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
            <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Select Endpoint</span>
            <ArrowRight className="size-4" />
            <BaseUrlSelect value={customBaseUrl || getDisplayUrl()} onChange={setCustomBaseUrl} requiresExternalUrl={tool.requiresExternalUrl} tunnelEnabled={tunnelEnabled} tunnelPublicUrl={tunnelPublicUrl} tailscaleEnabled={tailscaleEnabled} tailscaleUrl={tailscaleUrl} />
          </div>

          {openclawStatus?.settings?.models?.providers?.["modelhub"]?.baseUrl && (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
              <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Current</span>
              <ArrowRight className="size-4" />
              <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">{openclawStatus.settings.models.providers["modelhub"].baseUrl}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
            <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">API Key</span>
            <ArrowRight className="size-4" />
            <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
          </div>

          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
            <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Default Model</span>
            <ArrowRight className="size-4" />
            <div className="relative w-full min-w-0">
              <Input type="text" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} placeholder="provider/model-id" className="w-full min-w-0 pl-2 pr-7 py-2 text-xs sm:py-1.5" />
              {selectedModel && <Button variant="ghost" size="sm" onClick={() => setSelectedModel("")} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-red-500" title="Clear"><X className="size-4" /></Button>}
            </div>
            <Button variant="outline" size="sm" onClick={() => { setAgentModalFor(null); setModalOpen(true); }} disabled={!hasActiveProviders} className="w-full sm:w-auto">Select</Button>
          </div>

          {(openclawStatus?.agents || []).filter((a: { agentDir?: string }) => a.agentDir).map((agent: { id: string; name?: string }) => (
            <div key={agent.id} className="flex items-center gap-2 pl-4">
              <span className="w-32 shrink-0 text-xs text-primary text-right truncate" title={agent.name || agent.id}>Agent {agent.name || agent.id}</span>
              <ArrowRight className="size-4" />
              <div className="relative w-full min-w-0">
                <Input type="text" value={agentModels[agent.id] || ""} onChange={(e) => setAgentModels(prev => ({ ...prev, [agent.id]: e.target.value }))} placeholder={`default (${selectedModel || "provider/model-id"})`} className="w-full min-w-0 pl-2 pr-7 py-2 text-xs sm:py-1.5" />
                {agentModels[agent.id] && <Button variant="ghost" size="sm" onClick={() => setAgentModels(prev => ({ ...prev, [agent.id]: "" }))} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-red-500" title="Clear"><X className="size-4" /></Button>}
              </div>
              <Button variant="outline" size="sm" onClick={() => { setAgentModalFor(agent.id); setModalOpen(true); }} disabled={!hasActiveProviders} className="w-full sm:w-auto">Select</Button>
            </div>
          ))}
        </div>
      </ToolCardShell>

      {modalOpen && (
        <ModelSelectModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSelect={handleModelSelect} selectedModel={selectedModel} activeProviders={activeProviders} modelAliases={modelAliases} title="Select Model for Open Claw" />
      )}

      <ManualConfigModal isOpen={showManualConfigModal} onClose={() => setShowManualConfigModal(false)} title="Open Claw - Manual Configuration" configs={getManualConfigs()} />
    </>
  );
}

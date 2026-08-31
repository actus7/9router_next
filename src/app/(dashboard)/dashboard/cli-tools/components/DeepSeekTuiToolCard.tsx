"use client";

import { useState, useEffect, useRef } from "react";
import { Button, ModelSelectModal, ActiveProvider, ManualConfigModal } from "@/shared/components";
import { Input } from "@/components/ui/input";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";
import { AlertCircle, ArrowRight, Info, TriangleAlert, X } from "lucide-react";
import ToolCardShell from "./ToolCardShell";

interface ApiKey { id: string; key: string; }
interface ToolInfo { name: string; description?: string; requiresExternalUrl?: boolean; image?: string; notes?: Array<{ type: string; text: string }>; }
interface StatusData { installed?: boolean; hasModelHub?: boolean; settings?: { model?: { base_url?: string; default?: string; }; "providers.openai"?: { base_url?: string; model?: string; }; }; }
interface Message { type: "success" | "error"; text: string; }

interface DeepSeekTuiToolCardProps {
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

const ENDPOINT = "/api/cli-tools/deepseek-tui-settings";

export default function DeepSeekTuiToolCard({
  tool, isExpanded, onToggle, baseUrl, hasActiveProviders, apiKeys, activeProviders, cloudEnabled, initialStatus,
  tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl,
}: DeepSeekTuiToolCardProps) {
  const [deepseekStatus, setDeepseekStatus] = useState<StatusData | null>(initialStatus || null);
  const [checking, setChecking] = useState<boolean>(false);
  const [applying, setApplying] = useState<boolean>(false);
  const [restoring, setRestoring] = useState<boolean>(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [selectedApiKey, setSelectedApiKey] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [modelAliases, setModelAliases] = useState<Record<string, string>>({});
  const [showManualConfigModal, setShowManualConfigModal] = useState<boolean>(false);
  const [customBaseUrl, setCustomBaseUrl] = useState<string>("");
  const hasInitializedModel = useRef(false);

  const getConfigStatus = () => {
    if (!deepseekStatus?.installed) return null;
    const openaiSection = deepseekStatus.settings?.["providers.openai"];
    if (!openaiSection?.base_url) return "not_configured";
    if (matchKnownEndpoint(openaiSection.base_url, { tunnelPublicUrl, tailscaleUrl })) return "configured";
    return "other";
  };

  const configStatus = getConfigStatus();

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) setSelectedApiKey(apiKeys[0].key);
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (initialStatus) setDeepseekStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (isExpanded) {
      if (!deepseekStatus) checkStatus();
      fetchModelAliases();
    }
  }, [isExpanded]);

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
    if (deepseekStatus?.installed && !hasInitializedModel.current) {
      hasInitializedModel.current = true;
      const openaiSection = deepseekStatus.settings?.["providers.openai"];
      if (openaiSection?.model) setSelectedModel(openaiSection.model);
    }
  }, [deepseekStatus]);

  const checkStatus = async () => {
    setChecking(true);
    try {
      const res = await fetch(ENDPOINT);
      const data = await res.json();
      setDeepseekStatus(data);
    } catch (error) {
      setDeepseekStatus({ installed: false });
    } finally {
      setChecking(false);
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

  const handleApply = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const keyToUse = selectedApiKey?.trim()
        || (apiKeys?.length > 0 ? apiKeys[0].key : null)
        || (!cloudEnabled ? "sk_modelhub" : null);

      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: getEffectiveBaseUrl(), apiKey: keyToUse, model: selectedModel }),
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
      const res = await fetch(ENDPOINT, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setSelectedModel("");
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

  const handleModelSelect = (model: { value: string }) => {
    setSelectedModel(model.value);
    setModalOpen(false);
  };

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_modelhub" : "<API_KEY_FROM_DASHBOARD>");

    const tomlContent = `[providers.openai]
base_url = "${getEffectiveBaseUrl()}"
api_key = "${keyToUse}"
model = "${selectedModel || "provider/model-id"}"
`;

    return [{ filename: "~/.deepseek/config.toml", content: tomlContent }];
  };

  return (
    <>
      <ToolCardShell
        iconSrc={tool.image || "/providers/deepseek-tui.png"}
        toolName={tool.name}
        toolDescription={tool.description}
        configStatus={configStatus}
        isExpanded={isExpanded}
        onToggle={onToggle}
        checking={checking}
        checkingLabel="Checking DeepSeek TUI..."
        installed={deepseekStatus?.installed}
        notInstalledMessage="DeepSeek TUI not detected locally"
        notInstalledDetail="Manual configuration is still available if modelhub is deployed on a remote server."
        onManualConfig={() => setShowManualConfigModal(true)}
        message={message}
        onApply={handleApply}
        applyDisabled={!selectedModel}
        applyLoading={applying}
        onReset={handleReset}
        resetDisabled={!deepseekStatus?.hasModelHub}
        resetLoading={restoring}
      >
        <div className="flex flex-col gap-2">
          {tool.notes && tool.notes.length > 0 && (
            <div className="flex flex-col gap-2 mb-2">
              {tool.notes.map((note: { type: string; text: string }, idx: number) => (
                <div key={idx} className={`flex items-start gap-2 p-2 rounded text-xs ${
                  note.type === "warning" ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400" :
                  note.type === "error" ? "bg-red-500/10 text-red-600 dark:text-red-400" :
                  "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                }`}>
                  {note.type === "warning" ? <TriangleAlert className="size-4 mt-0.5" /> : note.type === "error" ? <AlertCircle className="size-4 mt-0.5" /> : <Info className="size-4 mt-0.5" />}
                  <span>{note.text}</span>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
            <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Select Endpoint</span>
            <ArrowRight className="size-4" />
            <BaseUrlSelect value={customBaseUrl || getEffectiveBaseUrl()} onChange={setCustomBaseUrl} requiresExternalUrl={tool.requiresExternalUrl} tunnelEnabled={tunnelEnabled} tunnelPublicUrl={tunnelPublicUrl} tailscaleEnabled={tailscaleEnabled} tailscaleUrl={tailscaleUrl} />
          </div>

          {deepseekStatus?.settings?.["providers.openai"]?.base_url && (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
              <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Current</span>
              <ArrowRight className="size-4" />
              <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">{deepseekStatus.settings["providers.openai"].base_url}</span>
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
            <Button variant="outline" size="sm" onClick={() => setModalOpen(true)} disabled={!hasActiveProviders} className="w-full sm:w-auto">Select</Button>
          </div>
        </div>
      </ToolCardShell>

      {modalOpen && (
        <ModelSelectModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSelect={handleModelSelect} selectedModel={selectedModel} activeProviders={activeProviders} modelAliases={modelAliases} title="Select Model for DeepSeek TUI" />
      )}

      <ManualConfigModal isOpen={showManualConfigModal} onClose={() => setShowManualConfigModal(false)} title="DeepSeek TUI - Manual Configuration" configs={getManualConfigs()} />
    </>
  );
}

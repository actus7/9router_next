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
interface StatusData { installed?: boolean; hasModelHub?: boolean; settings?: { model?: { base_url?: string; default?: string; }; }; }
interface Message { type: "success" | "error"; text: string; }

interface HermesToolCardProps {
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

const ENDPOINT = "/api/cli-tools/hermes-settings";

export default function HermesToolCard({
  tool, isExpanded, onToggle, baseUrl: _baseUrl, hasActiveProviders, apiKeys, activeProviders, cloudEnabled, initialStatus,
  tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl,
}: HermesToolCardProps) {
  const [hermesStatus, setHermesStatus] = useState<StatusData | null>(initialStatus || null);
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
    if (!hermesStatus?.installed) return null;
    const cfg = hermesStatus.settings?.model;
    if (!cfg?.base_url) return "not_configured";
    if (matchKnownEndpoint(cfg.base_url, { tunnelPublicUrl, tailscaleUrl })) return "configured";
    return "other";
  };

  const configStatus = getConfigStatus();

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) setSelectedApiKey(apiKeys[0].key);
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (initialStatus) setHermesStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (isExpanded) {
      if (!hermesStatus) checkStatus();
      fetchModelAliases();
    }
  }, [hermesStatus, isExpanded]);

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
    if (hermesStatus?.installed && !hasInitializedModel.current) {
      hasInitializedModel.current = true;
      const cfg = hermesStatus.settings?.model;
      if (cfg?.default) setSelectedModel(cfg.default);
    }
  }, [hermesStatus]);

  const checkStatus = async () => {
    setChecking(true);
    try {
      const res = await fetch(ENDPOINT);
      const data = await res.json();
      setHermesStatus(data);
    } catch  {
      setHermesStatus({ installed: false });
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

    const yamlContent = `model:\n  default: "${selectedModel || "provider/model-id"}"\n  provider: "custom"\n  base_url: "${getEffectiveBaseUrl()}"\n  api_key: \${OPENAI_API_KEY}\n`;
    const envContent = `OPENAI_API_KEY=${keyToUse}\n`;

    return [
      { filename: "~/.hermes/config.yaml", content: yamlContent },
      { filename: "~/.hermes/.env", content: envContent },
    ];
  };

  return (
    <>
      <ToolCardShell
        iconSrc="/providers/hermes.png"
        toolName={tool.name}
        toolDescription={tool.description}
        configStatus={configStatus}
        isExpanded={isExpanded}
        onToggle={onToggle}
        checking={checking}
        checkingLabel="Checking Hermes Agent..."
        installed={hermesStatus?.installed}
        notInstalledMessage="Hermes Agent not detected locally"
        notInstalledDetail="Install: curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash"
        message={message}
        capabilities={{
          manualConfig: { execute: () => setShowManualConfigModal(true) },
          apply: { execute: handleApply, disabled: !selectedModel, loading: applying },
          reset: { execute: handleReset, disabled: !hermesStatus?.hasModelHub, loading: restoring },
        }}
      >
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
            <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Select Endpoint</span>
            <ArrowRight className="size-4" />
            <BaseUrlSelect value={customBaseUrl || getEffectiveBaseUrl()} onChange={setCustomBaseUrl} requiresExternalUrl={tool.requiresExternalUrl} tunnelEnabled={tunnelEnabled} tunnelPublicUrl={tunnelPublicUrl} tailscaleEnabled={tailscaleEnabled} tailscaleUrl={tailscaleUrl} />
          </div>

          {hermesStatus?.settings?.model?.base_url && (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
              <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Current</span>
              <ArrowRight className="size-4" />
              <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">{hermesStatus.settings.model.base_url}</span>
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
              {selectedModel && <Button variant="ghost" size="sm" onClick={() => setSelectedModel("")} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-destructive-foreground" title="Clear"><X className="size-4" /></Button>}
            </div>
            <Button variant="outline" size="sm" onClick={() => setModalOpen(true)} disabled={!hasActiveProviders} className="w-full sm:w-auto">Select</Button>
          </div>
        </div>
      </ToolCardShell>

      {modalOpen && (
        <ModelSelectModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSelect={handleModelSelect} selectedModel={selectedModel} activeProviders={activeProviders} modelAliases={modelAliases} title="Select Model for Hermes Agent" />
      )}

      <ManualConfigModal isOpen={showManualConfigModal} onClose={() => setShowManualConfigModal(false)} title="Hermes Agent - Manual Configuration" configs={getManualConfigs()} />
    </>
  );
}

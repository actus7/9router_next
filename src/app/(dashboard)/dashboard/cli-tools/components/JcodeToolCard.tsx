"use client";

import { useState, useEffect, useRef } from "react";
import { Button, ModelSelectModal, ActiveProvider, ManualConfigModal } from "@/shared/components";
import { Input } from "@/components/ui/input";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";
import { ArrowRight, Info, TriangleAlert, X } from "lucide-react";
import ToolCardShell from "./ToolCardShell";

interface ApiKey { id: string; key: string; }
interface ToolInfo { name: string; description?: string; requiresExternalUrl?: boolean; image?: string; notes?: Array<{ type: string; text: string }>; }
interface StatusData { installed?: boolean; hasModelHub?: boolean; envApiKey?: string; config?: { providers?: Record<string, { base_url?: string; default_model?: string }>; }; settings?: { model?: { base_url?: string; default?: string; }; }; }
interface Message { type: "success" | "error"; text: string; }

interface JcodeToolCardProps {
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

export default function JcodeToolCard({
  tool, isExpanded, onToggle, baseUrl: _baseUrl, hasActiveProviders, apiKeys, activeProviders, cloudEnabled, initialStatus,
  tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl,
}: JcodeToolCardProps) {
  const [jcodeStatus, setJcodeStatus] = useState<StatusData | null>(initialStatus || null);
  const [checkingJcode, setCheckingJcode] = useState<boolean>(false);
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
    if (!jcodeStatus?.installed) return null;
    if (!jcodeStatus?.hasModelHub) return "not_configured";
    const currentProvider = jcodeStatus.config?.providers?.["modelhub"];
    if (!currentProvider) return "not_configured";
    return matchKnownEndpoint(currentProvider.base_url || "", { tunnelPublicUrl, tailscaleUrl }) ? "configured" : "other";
  };

  const configStatus = getConfigStatus();

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) setSelectedApiKey(apiKeys[0].key);
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (initialStatus) setJcodeStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (isExpanded) {
      if (!jcodeStatus) checkJcodeStatus();
      fetchModelAliases();
    }
  }, [isExpanded, jcodeStatus]);

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
    if (jcodeStatus?.installed && !hasInitializedModel.current) {
      hasInitializedModel.current = true;
      const provider = jcodeStatus.config?.providers?.["modelhub"];
      if (provider) {
        if (provider.default_model) setSelectedModel(provider.default_model);
        const envApiKey = jcodeStatus.envApiKey;
        if (envApiKey && apiKeys?.some(k => k.key === envApiKey)) setSelectedApiKey(envApiKey);
      }
    }
  }, [jcodeStatus, apiKeys]);

  const checkJcodeStatus = async () => {
    setCheckingJcode(true);
    try {
      const res = await fetch("/api/cli-tools/jcode-settings");
      const data = await res.json();
      setJcodeStatus(data);
    } catch  {
      setJcodeStatus({ installed: false });
    } finally {
      setCheckingJcode(false);
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

      const res = await fetch("/api/cli-tools/jcode-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: getEffectiveBaseUrl(), apiKey: keyToUse, models: selectedModel ? [selectedModel] : [] }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings applied successfully!" });
        checkJcodeStatus();
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
      const res = await fetch("/api/cli-tools/jcode-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setSelectedModel("");
        setSelectedApiKey("");
        checkJcodeStatus();
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

    const configToml = `[providers.modelhub]
type = "openai-compatible"
base_url = "${getEffectiveBaseUrl()}"
auth = "bearer"
api_key_env = "JCODE_MODELHUB_API_KEY"
env_file = "provider-modelhub.env"
default_model = "${selectedModel || "cc/claude-opus-4-7"}"
requires_api_key = true

[[providers.modelhub.models]]
id = "${selectedModel || "cc/claude-opus-4-7"}"`;

    const envContent = `JCODE_MODELHUB_API_KEY="${keyToUse}"`;

    return [
      { filename: "~/.jcode/config.toml", content: configToml },
      { filename: "~/.config/jcode/provider-modelhub.env", content: envContent },
    ];
  };

  return (
    <>
      <ToolCardShell
        iconSrc={tool.image || "/providers/jcode.png"}
        toolName={tool.name}
        toolDescription={tool.description}
        configStatus={configStatus}
        isExpanded={isExpanded}
        onToggle={onToggle}
        checking={checkingJcode}
        checkingLabel="Checking jcode CLI..."
        installed={jcodeStatus?.installed}
        notInstalledMessage="jcode CLI not detected locally"
        notInstalledChildren={
          <>
            <p className="text-sm text-text-muted mt-1">Install jcode to enable automatic configuration:</p>
            <code className="block mt-2 p-2 bg-black/20 rounded text-xs font-mono">
              curl -fsSL https://raw.githubusercontent.com/1jehuang/jcode/master/scripts/install.sh | bash
            </code>
            <p className="text-sm text-text-muted mt-2">Manual configuration is still available if modelhub is deployed on a remote server.</p>
          </>
        }
        onManualConfig={() => setShowManualConfigModal(true)}
        message={message}
        onApply={handleApplySettings}
        applyDisabled={!selectedModel}
        applyLoading={applying}
        onReset={handleResetSettings}
        resetDisabled={!jcodeStatus?.hasModelHub}
        resetLoading={restoring}
      >
        <div className="flex flex-col gap-2">
          {tool.notes && tool.notes.length > 0 && (
            <div className="flex flex-col gap-2 mb-2">
              {tool.notes.map((note: { type: string; text: string }, idx: number) => (
                <div key={idx} className={`flex items-start gap-2 p-2 rounded text-xs ${
                  note.type === "info" ? "bg-blue-500/10 text-blue-600 dark:text-blue-400" :
                  note.type === "warning" ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400" :
                  "bg-gray-500/10 text-text-muted"
                }`}>
                  {note.type === "info" ? <Info className="size-4 mt-0.5" /> : note.type === "warning" ? <TriangleAlert className="size-4 mt-0.5" /> : <Info className="size-4 mt-0.5" />}
                  <span>{note.text}</span>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
            <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Select Endpoint</span>
            <ArrowRight className="size-4" />
            <BaseUrlSelect value={customBaseUrl || getDisplayUrl()} onChange={setCustomBaseUrl} requiresExternalUrl={tool.requiresExternalUrl} tunnelEnabled={tunnelEnabled} tunnelPublicUrl={tunnelPublicUrl} tailscaleEnabled={tailscaleEnabled} tailscaleUrl={tailscaleUrl} />
          </div>

          {jcodeStatus?.config?.providers?.["modelhub"]?.base_url && (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
              <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Current</span>
              <ArrowRight className="size-4" />
              <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">{jcodeStatus.config.providers["modelhub"].base_url}</span>
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
              <Input type="text" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} placeholder="cc/claude-opus-4-7" className="w-full min-w-0 pl-2 pr-7 py-2 text-xs sm:py-1.5" />
              {selectedModel && <Button variant="ghost" size="sm" onClick={() => setSelectedModel("")} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-red-500" title="Clear"><X className="size-4" /></Button>}
            </div>
            <Button variant="outline" size="sm" onClick={() => setModalOpen(true)} disabled={!hasActiveProviders} className="w-full sm:w-auto">Select</Button>
          </div>

          <div className="flex flex-col gap-1 p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg">
            <p className="text-xs font-medium text-blue-600 dark:text-blue-400">Usage:</p>
            <code className="text-xs font-mono text-text-muted">jcode --provider-profile modelhub</code>
            <code className="text-xs font-mono text-text-muted">jcode --provider-profile modelhub --model {selectedModel || "cc/claude-opus-4-7"}</code>
          </div>
        </div>
      </ToolCardShell>

      {modalOpen && (
        <ModelSelectModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSelect={handleModelSelect} selectedModel={selectedModel} activeProviders={activeProviders} modelAliases={modelAliases} title="Select Model for jcode" />
      )}

      <ManualConfigModal isOpen={showManualConfigModal} onClose={() => setShowManualConfigModal(false)} title="jcode - Manual Configuration" configs={getManualConfigs()} />
    </>
  );
}

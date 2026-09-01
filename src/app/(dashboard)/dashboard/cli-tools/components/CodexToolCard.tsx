"use client";

import { useState, useEffect } from "react";
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
interface StatusData { installed?: boolean; hasModelHub?: boolean; config?: string; }
interface Message { type: "success" | "error"; text: string; }

interface CodexToolCardProps {
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

export default function CodexToolCard({ tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders, cloudEnabled, initialStatus, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl }: CodexToolCardProps) {
  const [codexStatus, setCodexStatus] = useState<StatusData | null>(initialStatus || null);
  const [checkingCodex, setCheckingCodex] = useState<boolean>(false);
  const [applying, setApplying] = useState<boolean>(false);
  const [restoring, setRestoring] = useState<boolean>(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [showInstallGuide, setShowInstallGuide] = useState<boolean>(false);
  const [selectedApiKey, setSelectedApiKey] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [subagentModel, setSubagentModel] = useState<string>("");
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [subagentModalOpen, setSubagentModalOpen] = useState<boolean>(false);
  const [modelAliases, setModelAliases] = useState<Record<string, string>>({});
  const [showManualConfigModal, setShowManualConfigModal] = useState<boolean>(false);
  const [customBaseUrl, setCustomBaseUrl] = useState<string>("");

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) setSelectedApiKey(apiKeys[0].key);
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (initialStatus) setCodexStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (isExpanded) {
      if (!codexStatus) checkCodexStatus();
      fetchModelAliases();
    }
  }, [codexStatus, isExpanded]);

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
    if (codexStatus?.config) {
      const modelMatch = codexStatus.config.match(/^model\s*=\s*"([^"]+)"/m);
      if (modelMatch) setSelectedModel(modelMatch[1]);
      const subagentModelMatch = codexStatus.config.match(/\[agents\.subagent\]\s*\n\s*model\s*=\s*"([^"]+)"/m);
      if (subagentModelMatch) setSubagentModel(subagentModelMatch[1]);
    }
  }, [codexStatus]);

  const getConfigStatus = () => {
    if (!codexStatus?.installed) return null;
    if (!codexStatus.config) return "not_configured";
    const parsed = codexStatus.config.match(/base_url\s*=\s*"([^"]+)"/);
    const currentUrl = parsed ? parsed[1] : "";
    return matchKnownEndpoint(currentUrl, { tunnelPublicUrl, tailscaleUrl }) ? "configured" : "other";
  };

  const configStatus = getConfigStatus();

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || `${baseUrl}/v1`;
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getDisplayUrl = () => customBaseUrl || `${baseUrl}/v1`;

  const checkCodexStatus = async () => {
    setCheckingCodex(true);
    try {
      const res = await fetch("/api/cli-tools/codex-settings");
      const data = await res.json();
      setCodexStatus(data);
    } catch  {
      setCodexStatus({ installed: false });
    } finally {
      setCheckingCodex(false);
    }
  };

  const handleApplySettings = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const keyToUse = (selectedApiKey && selectedApiKey.trim())
        ? selectedApiKey
        : (!cloudEnabled ? "sk_modelhub" : selectedApiKey);

      const res = await fetch("/api/cli-tools/codex-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          model: selectedModel,
          subagentModel: subagentModel || selectedModel
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings applied successfully!" });
        checkCodexStatus();
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
      const res = await fetch("/api/cli-tools/codex-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setSelectedModel("");
        setSubagentModel("");
        checkCodexStatus();
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
    if (!subagentModel) setSubagentModel(model.value);
    setModalOpen(false);
  };

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_modelhub" : "<API_KEY_FROM_DASHBOARD>");

    const effectiveSubagentModel = subagentModel || selectedModel;

    const configContent = `# ModelHub Configuration for Codex CLI
model = "${selectedModel}"
model_provider = "modelhub"

[model_providers.modelhub]
name = "ModelHub"
base_url = "${getEffectiveBaseUrl()}"
wire_api = "responses"

[agents.subagent]
model = "${effectiveSubagentModel}"
`;

    const authContent = JSON.stringify({
      auth_mode: "apikey",
      OPENAI_API_KEY: keyToUse
    }, null, 2);

    return [
      { filename: "~/.codex/config.toml", content: configContent },
      { filename: "~/.codex/auth.json", content: authContent },
    ];
  };

  return (
    <>
      <ToolCardShell
        iconSrc="/providers/codex.png"
        toolName={tool.name}
        toolDescription={tool.description}
        configStatus={configStatus}
        isExpanded={isExpanded}
        onToggle={onToggle}
        checking={checkingCodex}
        checkingLabel="Checking Codex CLI..."
        installed={codexStatus?.installed}
        notInstalledMessage="Codex CLI not detected locally"
        notInstalledDetail="Manual configuration is still available if modelhub is deployed on a remote server."
        message={message}
        capabilities={{
          manualConfig: { execute: () => setShowManualConfigModal(true) },
          installGuide: {
            expanded: showInstallGuide,
            toggle: () => setShowInstallGuide(!showInstallGuide),
            content: <div className="flex flex-col gap-3 text-sm">
            <div>
              <p className="text-text-muted mb-1">macOS / Linux / Windows:</p>
              <code className="block px-3 py-2 bg-black/5 dark:bg-white/5 rounded font-mono text-xs">npm install -g @openai/codex</code>
            </div>
            <p className="text-text-muted">After installation, run <code className="px-1 bg-black/5 dark:bg-white/5 rounded">codex</code> to verify.</p>
            <div className="pt-2 border-t border-border">
              <p className="text-text-muted text-xs">
                Codex uses <code className="px-1 bg-black/5 dark:bg-white/5 rounded">~/.codex/auth.json</code> with <code className="px-1 bg-black/5 dark:bg-white/5 rounded">OPENAI_API_KEY</code>.
                Click &quot;Apply&quot; to auto-configure.
              </p>
            </div>
          </div>,
          },
          apply: { execute: handleApplySettings, disabled: (!selectedApiKey && (cloudEnabled && apiKeys.length > 0)) || !selectedModel, loading: applying },
          reset: { execute: handleResetSettings, disabled: restoring, loading: restoring },
        }}
      >
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
            <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Select Endpoint</span>
            <ArrowRight className="size-4" />
            <BaseUrlSelect value={customBaseUrl || getDisplayUrl()} onChange={setCustomBaseUrl} requiresExternalUrl={tool.requiresExternalUrl} tunnelEnabled={tunnelEnabled} tunnelPublicUrl={tunnelPublicUrl} tailscaleEnabled={tailscaleEnabled} tailscaleUrl={tailscaleUrl} />
          </div>

          {codexStatus?.config && (() => {
            const parsed = codexStatus.config.match(/base_url\s*=\s*"([^"]+)"/);
            const currentBaseUrl = parsed ? parsed[1] : null;
            return currentBaseUrl ? (
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Current</span>
                <ArrowRight className="size-4" />
                <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">{currentBaseUrl}</span>
              </div>
            ) : null;
          })()}

          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
            <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">API Key</span>
            <ArrowRight className="size-4" />
            <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
          </div>

          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
            <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Model</span>
            <ArrowRight className="size-4" />
            <div className="relative w-full min-w-0">
              <Input type="text" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} placeholder="provider/model-id" className="w-full min-w-0 pl-2 pr-7 py-2 text-xs sm:py-1.5" />
              {selectedModel && <Button variant="ghost" size="sm" onClick={() => setSelectedModel("")} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-destructive-foreground" title="Clear"><X className="size-4" /></Button>}
            </div>
            <Button variant="outline" size="sm" onClick={() => setModalOpen(true)} disabled={!activeProviders?.length} className="w-full sm:w-auto">Select Model</Button>
          </div>

          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
            <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Subagent Model</span>
            <ArrowRight className="size-4" />
            <div className="relative w-full min-w-0">
              <Input type="text" value={subagentModel} onChange={(e) => setSubagentModel(e.target.value)} placeholder={selectedModel || "provider/model-id (defaults to main model)"} className="w-full min-w-0 pl-2 pr-7 py-2 text-xs sm:py-1.5" />
              {subagentModel && (
                <Button variant="ghost" size="sm" onClick={() => setSubagentModel("")} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-destructive-foreground" title="Clear (will use main model)">
                  <X className="size-4" />
                </Button>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => setSubagentModalOpen(true)} disabled={!activeProviders?.length} className="w-full sm:w-auto">
              Select Model
            </Button>
          </div>
        </div>
      </ToolCardShell>

      {modalOpen && (
        <ModelSelectModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSelect={handleModelSelect} selectedModel={selectedModel} activeProviders={activeProviders} modelAliases={modelAliases} title="Select Model for Codex" />
      )}

      {subagentModalOpen && (
        <ModelSelectModal isOpen={subagentModalOpen} onClose={() => setSubagentModalOpen(false)} onSelect={(model: { value: string }) => { setSubagentModel(model.value); setSubagentModalOpen(false); }} selectedModel={subagentModel} activeProviders={activeProviders} modelAliases={modelAliases} title="Select Subagent Model for Codex" />
      )}

      <ManualConfigModal isOpen={showManualConfigModal} onClose={() => setShowManualConfigModal(false)} title="Codex CLI - Manual Configuration" configs={getManualConfigs()} />
    </>
  );
}



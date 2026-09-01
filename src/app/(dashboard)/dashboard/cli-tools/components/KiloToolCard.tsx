"use client";

import { useState, useEffect } from "react";
import { Button, ModelSelectModal, ActiveProvider, ManualConfigModal } from "@/shared/components";
import { Input } from "@/components/ui/input";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { ArrowRight, X } from "lucide-react";
import ToolCardShell from "./ToolCardShell";

interface ApiKey { id: string; key: string; }
interface ToolInfo { name: string; description?: string; requiresExternalUrl?: boolean; }
interface StatusData { installed?: boolean; hasModelHub?: boolean; settings?: { openAiBaseUrl?: string; openAiModelId?: string; }; }
interface Message { type: "success" | "error"; text: string; }

interface KiloToolCardProps {
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

export default function KiloToolCard({ tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders, cloudEnabled, initialStatus, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl }: KiloToolCardProps) {
  const [status, setStatus] = useState<StatusData | null>(initialStatus || null);
  const [checking, setChecking] = useState<boolean>(false);
  const [applying, setApplying] = useState<boolean>(false);
  const [restoring, setRestoring] = useState<boolean>(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [showInstallGuide, setShowInstallGuide] = useState<boolean>(false);
  const [selectedApiKey, setSelectedApiKey] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [modelAliases, setModelAliases] = useState<Record<string, string>>({});
  const [showManualConfigModal, setShowManualConfigModal] = useState<boolean>(false);
  const [customBaseUrl, setCustomBaseUrl] = useState<string>("");

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
  }, [isExpanded, status]);

  const fetchModelAliases = async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch (error) {
      console.error("Error fetching model aliases:", error);
    }
  };

  const getConfigStatus = () => {
    if (!status?.installed) return null;
    return status.hasModelHub ? "configured" : "not_configured";
  };

  const configStatus = getConfigStatus();

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || `${baseUrl}/v1`;
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getDisplayUrl = () => customBaseUrl || `${baseUrl}/v1`;

  const checkStatus = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/cli-tools/kilo-settings");
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

      const res = await fetch("/api/cli-tools/kilo-settings", {
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
      const res = await fetch("/api/cli-tools/kilo-settings", { method: "DELETE" });
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

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_modelhub" : "<API_KEY_FROM_DASHBOARD>");

    return [{
      filename: "~/.local/share/kilo/auth.json",
      content: JSON.stringify({
        "openai-compatible": {
          type: "api-key",
          apiKey: keyToUse,
          baseUrl: getEffectiveBaseUrl(),
          model: selectedModel || "provider/model-id",
        },
      }, null, 2),
    }];
  };

  return (
    <>
      <ToolCardShell
        iconSrc="/providers/kilocode.png"
        toolName={tool.name}
        toolDescription={tool.description}
        configStatus={configStatus}
        isExpanded={isExpanded}
        onToggle={onToggle}
        checking={checking}
        checkingLabel="Checking Kilo Code..."
        installed={status?.installed}
        notInstalledMessage="Kilo Code not detected locally"
        notInstalledDetail="Manual configuration is still available if modelhub is deployed on a remote server."
        onManualConfig={() => setShowManualConfigModal(true)}
        hasInstallGuide
        showInstallGuide={showInstallGuide}
        onToggleInstallGuide={() => setShowInstallGuide(!showInstallGuide)}
        installGuideContent={
          <p className="text-sm text-text-muted">Install Kilo Code from <a className="text-primary underline" href="https://kilocode.ai" target="_blank" rel="noreferrer">kilocode.ai</a> or VS Code extension marketplace.</p>
        }
        message={message}
        onApply={handleApply}
        applyDisabled={(!selectedApiKey && (cloudEnabled && apiKeys.length > 0)) || !selectedModel}
        applyLoading={applying}
        onReset={handleReset}
        resetDisabled={restoring}
        resetLoading={restoring}
      >
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

          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
            <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Model</span>
            <ArrowRight className="size-4" />
            <div className="relative w-full min-w-0">
              <Input type="text" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} placeholder="provider/model-id" className="w-full min-w-0 pl-2 pr-7 py-2 text-xs sm:py-1.5" />
              {selectedModel && <Button variant="ghost" size="sm" onClick={() => setSelectedModel("")} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-red-500" title="Clear"><X className="size-4" /></Button>}
            </div>
            <Button variant="outline" size="sm" onClick={() => setModalOpen(true)} disabled={!activeProviders?.length} className="w-full sm:w-auto">Select Model</Button>
          </div>
        </div>
      </ToolCardShell>

      {modalOpen && (
        <ModelSelectModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSelect={(model: { value: string }) => { setSelectedModel(model.value); setModalOpen(false); }} selectedModel={selectedModel} activeProviders={activeProviders} modelAliases={modelAliases} title="Select Model for Kilo Code" />
      )}

      <ManualConfigModal isOpen={showManualConfigModal} onClose={() => setShowManualConfigModal(false)} title="Kilo Code - Manual Configuration" configs={getManualConfigs()} />
    </>
  );
}

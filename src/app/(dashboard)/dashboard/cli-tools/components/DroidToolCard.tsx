"use client";

import { useState, useEffect, useRef } from "react";
import { Button, ModelSelectModal, ActiveProvider, ManualConfigModal } from "@/shared/components";
import { Input } from "@/components/ui/input";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";
import { ArrowRight, Plus, X } from "lucide-react";
import ToolCardShell from "./ToolCardShell";

interface ApiKey { id: string; key: string; }
interface ToolInfo { name: string; description?: string; requiresExternalUrl?: boolean; }
interface StatusData { installed?: boolean; hasModelHub?: boolean; settings?: { customModels?: Array<{ id?: string; model?: string; baseUrl?: string; index?: number }>; }; }
interface Message { type: "success" | "error"; text: string; }

interface DroidToolCardProps {
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

const CLOUD_URL = process.env.NEXT_PUBLIC_CLOUD_URL;

export default function DroidToolCard({
  tool, isExpanded, onToggle, baseUrl, hasActiveProviders, apiKeys, activeProviders, cloudEnabled, initialStatus,
  tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl,
}: DroidToolCardProps) {
  const [droidStatus, setDroidStatus] = useState<StatusData | null>(initialStatus || null);
  const [checkingDroid, setCheckingDroid] = useState<boolean>(false);
  const [applying, setApplying] = useState<boolean>(false);
  const [restoring, setRestoring] = useState<boolean>(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [selectedApiKey, setSelectedApiKey] = useState<string>("");
  const [modelList, setModelList] = useState<string[]>([]);
  const [modelInput, setModelInput] = useState<string>("");
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [modelAliases, setModelAliases] = useState<Record<string, string>>({});
  const [showManualConfigModal, setShowManualConfigModal] = useState<boolean>(false);
  const [showInstallGuide, setShowInstallGuide] = useState<boolean>(false);
  const [customBaseUrl, setCustomBaseUrl] = useState<string>("");
  const hasInitializedModel = useRef(false);

  const getConfigStatus = () => {
    if (!droidStatus?.installed) return null;
    const currentConfig = droidStatus.settings?.customModels?.find(m => m.id?.startsWith("custom:ModelHub"));
    if (!currentConfig) return "not_configured";
    return matchKnownEndpoint(currentConfig.baseUrl || "", { tunnelPublicUrl, tailscaleUrl, cloudUrl: cloudEnabled ? CLOUD_URL : null }) ? "configured" : "other";
  };

  const configStatus = getConfigStatus();

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) setSelectedApiKey(apiKeys[0].key);
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (initialStatus) setDroidStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (isExpanded) {
      if (!droidStatus) checkDroidStatus();
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
    if (droidStatus?.installed && !hasInitializedModel.current) {
      hasInitializedModel.current = true;
      const existingModels = (droidStatus.settings?.customModels || [])
        .filter(m => m.id?.startsWith("custom:ModelHub"))
        .sort((a, b) => (a.index || 0) - (b.index || 0))
        .map(m => m.model || "");
      if (existingModels.length > 0) {
        setModelList(existingModels);
      } else {
        const legacy = droidStatus.settings?.customModels?.find(m => m.id === "custom:ModelHub-0");
        if (legacy?.model) setModelList([legacy.model]);
      }
    }
  }, [droidStatus]);

  const checkDroidStatus = async () => {
    setCheckingDroid(true);
    try {
      const res = await fetch("/api/cli-tools/droid-settings");
      const data = await res.json();
      setDroidStatus(data);
    } catch (error) {
      setDroidStatus({ installed: false });
    } finally {
      setCheckingDroid(false);
    }
  };

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || baseUrl;
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getDisplayUrl = () => {
    const url = customBaseUrl || baseUrl;
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const addModel = () => {
    const val = modelInput.trim();
    if (!val || modelList.includes(val)) return;
    setModelList((prev) => [...prev, val]);
    setModelInput("");
  };

  const removeModel = (id: string) => setModelList((prev) => prev.filter((m) => m !== id));

  const handleModelSelect = (model: { value: string }) => {
    if (!model.value || modelList.includes(model.value)) return;
    setModelList((prev) => [...prev, model.value]);
    setModalOpen(false);
  };

  const handleApplySettings = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const keyToUse = selectedApiKey?.trim()
        || (apiKeys?.length > 0 ? apiKeys[0].key : null)
        || (!cloudEnabled ? "sk_modelhub" : null);

      const res = await fetch("/api/cli-tools/droid-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          models: modelList,
          activeModel: modelList[0] || "",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings applied successfully!" });
        checkDroidStatus();
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
      const res = await fetch("/api/cli-tools/droid-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setModelList([]);
        checkDroidStatus();
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

    const settingsContent = {
      customModels: modelList.map((m, i) => ({
        model: m,
        id: `custom:ModelHub-${i}`,
        index: i,
        baseUrl: getEffectiveBaseUrl(),
        apiKey: keyToUse,
        displayName: m,
        maxOutputTokens: 131072,
        noImageSupport: false,
        provider: "openai",
      })),
    };

    const platform = typeof navigator !== "undefined" ? navigator.platform : "";
    const isWindows = platform.toLowerCase().includes("win");
    const settingsPath = isWindows
      ? "%USERPROFILE%\\.factory\\settings.json"
      : "~/.factory/settings.json";

    return [{ filename: settingsPath, content: JSON.stringify(settingsContent, null, 2) }];
  };

  return (
    <>
      <ToolCardShell
        iconSrc="/providers/droid.png"
        toolName={tool.name}
        toolDescription={tool.description}
        configStatus={configStatus}
        isExpanded={isExpanded}
        onToggle={onToggle}
        checking={checkingDroid}
        checkingLabel="Checking Factory Droid CLI..."
        installed={droidStatus?.installed}
        notInstalledMessage="Factory Droid CLI not detected locally"
        notInstalledDetail="Manual configuration is still available if modelhub is deployed on a remote server."
        onManualConfig={() => setShowManualConfigModal(true)}
        hasInstallGuide
        showInstallGuide={showInstallGuide}
        onToggleInstallGuide={() => setShowInstallGuide(!showInstallGuide)}
        installGuideContent={
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-text-muted mb-1">macOS / Linux / Windows:</p>
              <code className="block px-3 py-2 bg-black/5 dark:bg-white/5 rounded font-mono text-xs">curl -fsSL https://app.factory.ai/cli | sh</code>
            </div>
            <p className="text-text-muted">After installation, run <code className="px-1 bg-black/5 dark:bg-white/5 rounded">droid</code> to verify.</p>
          </div>
        }
        message={message}
        onApply={handleApplySettings}
        applyDisabled={modelList.length === 0}
        applyLoading={applying}
        onReset={handleResetSettings}
        resetDisabled={!droidStatus?.hasModelHub}
        resetLoading={restoring}
      >
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
            <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Select Endpoint</span>
            <ArrowRight className="size-4" />
            <BaseUrlSelect value={customBaseUrl || getDisplayUrl()} onChange={setCustomBaseUrl} requiresExternalUrl={tool.requiresExternalUrl} tunnelEnabled={tunnelEnabled} tunnelPublicUrl={tunnelPublicUrl} tailscaleEnabled={tailscaleEnabled} tailscaleUrl={tailscaleUrl} />
          </div>

          {droidStatus?.settings?.customModels?.find(m => m.id?.startsWith("custom:ModelHub"))?.baseUrl && (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
              <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Current</span>
              <ArrowRight className="size-4" />
              <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">
                {droidStatus.settings.customModels.find(m => m.id?.startsWith("custom:ModelHub"))!.baseUrl}
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
            <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">API Key</span>
            <ArrowRight className="size-4" />
            <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
          </div>

          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
            <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">
              Models {modelList.length > 0 && <span className="text-primary">({modelList.length})</span>}
            </span>
            <ArrowRight className="size-4" />
            <div className="flex-1 flex flex-col gap-1">
              {modelList.length > 0 && (
                <div className="flex flex-col gap-0.5 mb-1">
                  {modelList.map((id) => (
                    <div key={id} className="flex items-center gap-1.5 px-2 py-1 bg-bg-secondary rounded border border-border">
                      <span className="flex-1 text-xs font-mono truncate">{id}</span>
                      <Button variant="ghost" size="sm" onClick={() => removeModel(id)} className="text-text-muted hover:text-red-500 shrink-0 p-0 h-auto" title="Remove">
                        <X className="size-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <Input
                  type="text"
                  value={modelInput}
                  onChange={(e) => setModelInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addModel(); } }}
                  placeholder="provider/model-id"
                  className="w-full min-w-0 px-2 py-2 text-xs sm:py-1.5"
                />
                <Button variant="outline" size="sm" onClick={() => setModalOpen(true)} disabled={!hasActiveProviders} className="shrink-0">
                  Select
                </Button>
                <Button variant="outline" size="sm" onClick={addModel} disabled={!modelInput.trim()} className="shrink-0" title="Add model">
                  <Plus className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </ToolCardShell>

      {modalOpen && (
        <ModelSelectModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSelect={handleModelSelect} selectedModel={undefined} activeProviders={activeProviders} modelAliases={modelAliases} title="Select Model for Factory Droid" />
      )}

      <ManualConfigModal isOpen={showManualConfigModal} onClose={() => setShowManualConfigModal(false)} title="Factory Droid - Manual Configuration" configs={getManualConfigs()} />
    </>
  );
}

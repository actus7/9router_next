"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import { Input } from "@/components/ui/input";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";
import { AlertCircle, ArrowRight, CheckCircle2, ChevronDown, ChevronUp, Copy, History, Info, Loader2, Plus, Save, TriangleAlert, X } from "lucide-react";

interface ApiKey { id: string; key: string; }
interface ToolInfo { name: string; description?: string; requiresExternalUrl?: boolean; }
interface StatusData { installed?: boolean; has9Router?: boolean; settings?: { customModels?: Array<{ id?: string; model?: string; baseUrl?: string; index?: number }>; }; }
interface Message { type: "success" | "error"; text: string; }

interface DroidToolCardProps {
  tool: ToolInfo;
  isExpanded: boolean;
  onToggle: () => void;
  baseUrl: string;
  hasActiveProviders: boolean;
  apiKeys: ApiKey[];
  activeProviders: unknown[];
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
  const [modelAliases, setModelAliases] = useState<Record<string, unknown>>({});
  const [showManualConfigModal, setShowManualConfigModal] = useState<boolean>(false);
  const [showInstallGuide, setShowInstallGuide] = useState<boolean>(false);
  const [customBaseUrl, setCustomBaseUrl] = useState<string>("");
  const hasInitializedModel = useRef(false);

  const getConfigStatus = () => {
    if (!droidStatus?.installed) return null;
    const currentConfig = droidStatus.settings?.customModels?.find(m => m.id?.startsWith("custom:9Router"));
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
        .filter(m => m.id?.startsWith("custom:9Router"))
        .sort((a, b) => (a.index || 0) - (b.index || 0))
        .map(m => m.model || "");
      if (existingModels.length > 0) {
        setModelList(existingModels);
      } else {
        const legacy = droidStatus.settings?.customModels?.find(m => m.id === "custom:9Router-0");
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
        || (!cloudEnabled ? "sk_9router" : null);

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
      : (!cloudEnabled ? "sk_9router" : "<API_KEY_FROM_DASHBOARD>");

    const settingsContent = {
      customModels: modelList.map((m, i) => ({
        model: m,
        id: `custom:9Router-${i}`,
        index: i,
        baseUrl: getEffectiveBaseUrl(),
        apiKey: keyToUse,
        displayName: m,
        maxOutputTokens: 131072,
        noImageSupport: false,
        provider: "openai",
      })),
    };

    const platform = typeof navigator !== "undefined" && navigator.platform;
    const isWindows = platform?.toLowerCase().includes("win");
    const settingsPath = isWindows
      ? "%USERPROFILE%\\.factory\\settings.json"
      : "~/.factory/settings.json";

    return [{ filename: settingsPath, content: JSON.stringify(settingsContent, null, 2) }];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src="/providers/droid.png" alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} loading="lazy" decoding="async" />
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
          {checkingDroid && (
            <div className="flex items-center gap-2 text-text-muted">
              <Loader2 className="size-4" />
              <span>Checking Factory Droid CLI...</span>
            </div>
          )}

          {!checkingDroid && droidStatus && !droidStatus.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <TriangleAlert className="size-4" />
                  <div className="flex-1">
                    <p className="font-medium text-yellow-600 dark:text-yellow-400">Factory Droid CLI not detected locally</p>
                    <p className="text-sm text-text-muted">Manual configuration is still available if 9router is deployed on a remote server.</p>
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
                      <p className="text-text-muted mb-1">macOS / Linux / Windows:</p>
                      <code className="block px-3 py-2 bg-black/5 dark:bg-white/5 rounded font-mono text-xs">curl -fsSL https://app.factory.ai/cli | sh</code>
                    </div>
                    <p className="text-text-muted">After installation, run <code className="px-1 bg-black/5 dark:bg-white/5 rounded">droid</code> to verify.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {!checkingDroid && droidStatus?.installed && (
            <>
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Select Endpoint</span>
                  <ArrowRight className="size-4" />
                  <BaseUrlSelect value={customBaseUrl || getDisplayUrl()} onChange={setCustomBaseUrl} requiresExternalUrl={tool.requiresExternalUrl} tunnelEnabled={tunnelEnabled} tunnelPublicUrl={tunnelPublicUrl} tailscaleEnabled={tailscaleEnabled} tailscaleUrl={tailscaleUrl} />
                </div>

                {droidStatus?.settings?.customModels?.find(m => m.id?.startsWith("custom:9Router"))?.baseUrl && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Current</span>
                    <ArrowRight className="size-4" />
                    <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">
                      {droidStatus.settings.customModels.find(m => m.id?.startsWith("custom:9Router"))!.baseUrl}
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

              {message && (
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}>
                  {message.type === "success" ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
                  <span>{message.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
                <Button variant="primary" size="sm" onClick={handleApplySettings} disabled={modelList.length === 0} loading={applying}>
                  <Save className="size-4" />Apply
                </Button>
                <Button variant="outline" size="sm" onClick={handleResetSettings} disabled={!droidStatus?.has9Router} loading={restoring}>
                  <History className="size-4" />Reset
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowManualConfigModal(true)}>
                  <Copy className="size-4" />Manual Config
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {modalOpen && (
        <ModelSelectModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSelect={handleModelSelect} selectedModel={null} activeProviders={activeProviders} modelAliases={modelAliases} title="Select Model for Factory Droid" />
      )}

      <ManualConfigModal isOpen={showManualConfigModal} onClose={() => setShowManualConfigModal(false)} title="Factory Droid - Manual Configuration" configs={getManualConfigs()} />
    </Card>
  );
}

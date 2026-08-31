"use client";

import { useState, useEffect } from "react";
import { Card, Button, ModelSelectModal, ActiveProvider, ManualConfigModal, ComboFormModal, McpMarketplaceModal } from "@/shared/components";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { AlertCircle, ArrowRight, CheckCircle2, ChevronDown, Copy, History, Loader2, Save, TriangleAlert, X } from "lucide-react";
import { McpPluginsSection, ToolsSection, LocalPluginsSection, AddMcpModal } from "./CoworkSections";

interface ApiKey { id: string; key: string; }
interface ToolInfo { name: string; description?: string; image?: string; requiresExternalUrl?: boolean; }
interface StatusData { installed?: boolean; hasModelHub?: boolean; cowork?: { models?: string[]; baseUrl?: string; plugins?: Plugin[]; localPlugins?: string[]; customPlugins?: CustomPlugin[]; }; defaultPlugins?: Plugin[]; localStdioPlugins?: Array<{ name: string; title?: string; description?: string; extensionUrl?: string }>; }
interface Plugin { name: string; title?: string; oauth?: boolean; toolNames?: string[]; }
interface CustomPlugin { name: string; url: string; transport?: string; custom?: boolean; }
interface Message { type: "success" | "error"; text: string; }

interface CoworkToolCardProps {
  tool: ToolInfo;
  isExpanded: boolean;
  onToggle: () => void;
  baseUrl: string;
  apiKeys: ApiKey[];
  activeProviders: ActiveProvider[];
  hasActiveProviders: boolean;
  cloudEnabled: boolean;
  cloudUrl?: string;
  tunnelEnabled: boolean;
  tunnelPublicUrl: string;
  tailscaleEnabled: boolean;
  tailscaleUrl: string;
  initialStatus?: StatusData | null;
}

const ENDPOINT = "/api/cli-tools/cowork-settings";

const stripV1 = (url: string) => (url || "").replace(/\/v1\/?$/, "");
const ensureV1 = (url: string) => {
  const trimmed = (url || "").replace(/\/+$/, "");
  if (!trimmed) return "";
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
};

export default function CoworkToolCard({
  tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders, hasActiveProviders, cloudEnabled, cloudUrl,
  tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl, initialStatus,
}: CoworkToolCardProps) {
  const [status, setStatus] = useState<StatusData | null>(initialStatus || null);
  const [checking, setChecking] = useState<boolean>(false);
  const [applying, setApplying] = useState<boolean>(false);
  const [restoring, setRestoring] = useState<boolean>(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [selectedApiKey, setSelectedApiKey] = useState<string>("");
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [showManualConfigModal, setShowManualConfigModal] = useState<boolean>(false);
  const [customBaseUrl, setCustomBaseUrl] = useState<string>("");
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [localPlugins, setLocalPlugins] = useState<string[]>([]);
  const [customPlugins, setCustomPlugins] = useState<CustomPlugin[]>([]);
  const [modelAliases, setModelAliases] = useState<Record<string, string>>({});
  const [comboModalOpen, setComboModalOpen] = useState<boolean>(false);
  const [modelSelectOpen, setModelSelectOpen] = useState<boolean>(false);
  const [marketplaceOpen, setMarketplaceOpen] = useState<boolean>(false);
  const [addMcpOpen, setAddMcpOpen] = useState<boolean>(false);

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) setSelectedApiKey(apiKeys[0].key);
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (initialStatus) setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (isExpanded && !status) checkStatus();
  }, [isExpanded]);

  useEffect(() => {
    if (!isExpanded) return;
    fetch("/api/models/alias")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) setModelAliases(data.aliases || {});
      })
      .catch(() => {});
  }, [isExpanded]);

  useEffect(() => {
    if (status?.cowork?.models?.length) setSelectedModels(status.cowork.models);
    if (status?.cowork?.baseUrl && !customBaseUrl) setCustomBaseUrl(stripV1(status.cowork.baseUrl));
    if (Array.isArray(status?.cowork?.plugins) && status.cowork.plugins.length > 0) {
      setPlugins(status.cowork.plugins);
    } else if (plugins.length === 0 && Array.isArray(status?.defaultPlugins)) {
      setPlugins(status.defaultPlugins);
    }
    if (Array.isArray(status?.cowork?.localPlugins)) setLocalPlugins(status.cowork.localPlugins);
    if (Array.isArray(status?.cowork?.customPlugins) && status.cowork.customPlugins.length > 0) setCustomPlugins(status.cowork.customPlugins);
  }, [status]);

  const checkStatus = async () => {
    setChecking(true);
    try {
      const res = await fetch(ENDPOINT);
      const data = await res.json();
      setStatus(data);
    } catch (error) {
      setStatus({ installed: false });
    } finally {
      setChecking(false);
    }
  };

  const getEffectiveBaseUrl = () => ensureV1(customBaseUrl);

  const getConfigStatus = () => {
    if (!status?.installed) return null;
    const url = status?.cowork?.baseUrl;
    if (!url) return "not_configured";
    return status.hasModelHub ? "configured" : "other";
  };

  const configStatus = getConfigStatus();

  const handleApply = async () => {
    setMessage(null);
    const effectiveUrl = getEffectiveBaseUrl();

    if (selectedModels.length === 0) {
      setMessage({ type: "error", text: "Please select at least one model" });
      return;
    }

    setApplying(true);
    try {
      const keyToUse = selectedApiKey?.trim()
        || (apiKeys?.length > 0 ? apiKeys[0].key : null)
        || (!cloudEnabled ? "sk_modelhub" : null);

      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: effectiveUrl, apiKey: keyToUse, models: selectedModels, plugins, localPlugins, customPlugins }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings applied. Quit & reopen Claude Desktop to load." });
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

  const handleCreateCombo = async ({ name, models }: { name: string; models: string[] }) => {
    try {
      const res = await fetch("/api/combos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, models }),
      });
      if (!res.ok) {
        const err = await res.json();
        setMessage({ type: "error", text: err.error || "Failed to create combo" });
        return;
      }
      if (!selectedModels.includes(name)) {
        setSelectedModels([...selectedModels, name]);
      }
      setComboModalOpen(false);
      setMessage({ type: "success", text: `Combo "${name}" created and added.` });
    } catch (error) {
      setMessage({ type: "error", text: (error as Error).message });
    }
  };

  const handleAddModel = (model: { value?: string; name?: string } | string) => {
    const value = (model as { value?: string; name?: string })?.value || (model as { value?: string; name?: string })?.name || model;
    if (!value || selectedModels.includes(value as string)) return;
    setSelectedModels((prev) => [...prev, value as string]);
  };

  const handleRemoveModel = (model: { value?: string; name?: string } | string) => {
    const value = (model as { value?: string; name?: string })?.value || (model as { value?: string; name?: string })?.name || model;
    setSelectedModels((prev) => prev.filter((item) => item !== value));
  };

  const handleReset = async () => {
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch(ENDPOINT, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully" });
        setSelectedModels([]);
        setPlugins(status?.defaultPlugins || []);
        setLocalPlugins([]);
        setCustomPlugins([]);
        checkStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset" });
      }
    } catch (error) {
      setMessage({ type: "error", text: (error as Error).message });
    } finally {
      setRestoring(false);
    }
  };

  const addPlugin = (p: Plugin) => {
    if (plugins.some((x) => x.name === p.name)) return;
    setPlugins([...plugins, p]);
  };

  const removePlugin = (name: string) => {
    setPlugins(plugins.filter((p) => p.name !== name));
  };

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_modelhub" : "<API_KEY_FROM_DASHBOARD>");

    const modelsToShow = selectedModels.length > 0 ? selectedModels : ["provider/model-id"];
    const cfg = {
      inferenceProvider: "gateway",
      inferenceGatewayBaseUrl: getEffectiveBaseUrl() || "https://your-public-host/v1",
      inferenceGatewayApiKey: keyToUse,
      inferenceModels: modelsToShow.map((name) => ({ name })),
    };

    return [{
      filename: "~/Library/Application Support/Claude-3p/configLibrary/<appliedId>.json",
      content: JSON.stringify(cfg, null, 2),
    }];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src={tool.image!} alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} loading="lazy" decoding="async" />
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
              <span>Checking Claude Cowork...</span>
            </div>
          )}

          {!checking && status && !status.installed && (
            <div className="flex flex-col gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <div className="flex items-start gap-3">
                <TriangleAlert className="size-4" />
                <div className="flex-1">
                  <p className="font-medium text-yellow-600 dark:text-yellow-400">Claude Desktop (Cowork mode) not detected</p>
                  <p className="text-sm text-text-muted">Open Claude Desktop → Help → Troubleshooting → Enable Developer mode → Configure third-party inference, then return here.</p>
                </div>
              </div>
              <div className="pl-9">
                <Button variant="secondary" size="sm" onClick={() => setShowManualConfigModal(true)} className="!bg-yellow-500/20 !border-yellow-500/40 !text-yellow-700 dark:!text-yellow-300 hover:!bg-yellow-500/30">
                  <Copy className="size-5" />
                  Manual Config
                </Button>
              </div>
            </div>
          )}

          {!checking && status?.installed && (
            <>
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Select Endpoint</span>
                  <ArrowRight className="size-4" />
                  <BaseUrlSelect value={getEffectiveBaseUrl()} onChange={(url) => setCustomBaseUrl(stripV1(url))} tunnelEnabled={tunnelEnabled} tunnelPublicUrl={tunnelPublicUrl} tailscaleEnabled={tailscaleEnabled} tailscaleUrl={tailscaleUrl} cloudEnabled={cloudEnabled} cloudUrl={cloudUrl} />
                </div>

                {status?.cowork?.baseUrl && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Current</span>
                    <ArrowRight className="size-4" />
                    <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">{status.cowork.baseUrl}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">API Key</span>
                  <ArrowRight className="size-4" />
                  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right">Models</span>
                  <ArrowRight className="size-4" />
                  <div className="flex-1 flex items-center gap-2">
                    <div className="flex-1 flex flex-wrap gap-1.5 min-h-[28px] px-2 py-1.5 bg-surface rounded border border-border">
                      {selectedModels.length === 0 ? (
                        <span className="text-xs text-text-muted">No models selected</span>
                      ) : (
                        selectedModels.map((m) => (
                          <span key={m} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-black/5 dark:bg-white/5 text-text-muted border border-transparent hover:border-border">
                            {m}
                            <Button variant="ghost" size="sm" onClick={() => handleRemoveModel(m)} className="ml-0.5 hover:text-red-500 p-0 h-auto">
                              <X className="size-3" />
                            </Button>
                          </span>
                        ))
                      )}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setComboModalOpen(true)} disabled={!hasActiveProviders} className="shrink-0">+ Combo</Button>
                  </div>
                </div>

                <McpPluginsSection
                  plugins={plugins}
                  customPlugins={customPlugins}
                  onRemovePlugin={removePlugin}
                  onRemoveCustomPlugin={(name) => setCustomPlugins(customPlugins.filter((x) => x.name !== name))}
                  onOpenMarketplace={() => setMarketplaceOpen(true)}
                  onOpenAddMcp={() => setAddMcpOpen(true)}
                />

                <ToolsSection
                  plugins={plugins}
                  localPlugins={localPlugins}
                  defaultPlugins={status?.defaultPlugins || []}
                  localStdioPlugins={status?.localStdioPlugins || []}
                  onPluginsChange={setPlugins}
                  onLocalPluginsChange={setLocalPlugins}
                />

                <LocalPluginsSection
                  localStdioPlugins={status?.localStdioPlugins || []}
                  localPlugins={localPlugins}
                  onLocalPluginsChange={setLocalPlugins}
                />
              </div>

              {message && (
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}>
                  {message.type === "success" ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
                  <span>{message.text}</span>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <Button variant="primary" size="sm" onClick={handleApply} disabled={selectedModels.length === 0} loading={applying} className="w-full sm:w-auto">
                  <Save className="size-4" />Apply
                </Button>
                <Button variant="outline" size="sm" onClick={handleReset} disabled={!status.hasModelHub} loading={restoring} className="w-full sm:w-auto">
                  <History className="size-4" />Reset
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowManualConfigModal(true)} className="w-full sm:w-auto">
                  <Copy className="size-4" />Manual Config
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <ManualConfigModal isOpen={showManualConfigModal} onClose={() => setShowManualConfigModal(false)} title="Claude Cowork - Manual Configuration" configs={getManualConfigs()} />

      {comboModalOpen && (
        <ComboFormModal isOpen={comboModalOpen} combo={null} onClose={() => setComboModalOpen(false)} onSave={handleCreateCombo} activeProviders={activeProviders} forcePrefix="claude-" title="Create Cowork Combo" />
      )}

      {modelSelectOpen && (
        <ModelSelectModal isOpen={modelSelectOpen} onClose={() => setModelSelectOpen(false)} onSelect={handleAddModel} onDeselect={handleRemoveModel} activeProviders={activeProviders} modelAliases={modelAliases} title="Select Cowork Model" addedModelValues={selectedModels} closeOnSelect={false} />
      )}

      <McpMarketplaceModal isOpen={marketplaceOpen} onClose={() => setMarketplaceOpen(false)} onAdd={addPlugin} addedNames={plugins.map((p) => p.name)} />

      <AddMcpModal
        isOpen={addMcpOpen}
        onClose={() => setAddMcpOpen(false)}
        onAdd={(plugin) => {
          setCustomPlugins((prev) => [...prev.filter((x) => x.name !== plugin.name), plugin]);
        }}
      />
    </Card>
  );
}

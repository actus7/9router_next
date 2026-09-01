"use client";

import { useState, useEffect, useRef } from "react";
import { Card, ModelSelectModal, ActiveProvider, ManualConfigModal } from "@/shared/components";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";
import { useModelAliases } from "./useCliToolCommon";
import { StatusMessage, ActionButtons } from "./CliToolShared";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, ChevronDown, ChevronUp, Copy, Info, Loader2, TriangleAlert, X } from "lucide-react";

const CLOUD_URL = process.env.NEXT_PUBLIC_CLOUD_URL;

const CONTEXT_OPTIONS = [
  { label: "Default", value: "" },
  { label: "200K", value: "198000" },
  { label: "300K", value: "298000" },
  { label: "500K", value: "498000" },
  { label: "1M", value: "998000" },
];

interface ApiKey { id: string; key: string; }
interface ToolInfo { name: string; description?: string; defaultModels: Array<{ alias: string; name: string; envKey?: string; defaultValue?: string }>; requiresExternalUrl?: boolean; }
interface StatusData { installed?: boolean; hasModelHub?: boolean; hasBackup?: boolean; exaMcpEnabled?: boolean; settings?: { env?: Record<string, string> }; }
interface Message { type: "success" | "error"; text: string; }

interface ClaudeToolCardProps {
  tool: ToolInfo;
  isExpanded: boolean;
  onToggle: () => void;
  activeProviders: ActiveProvider[];
  modelMappings: Record<string, string>;
  onModelMappingChange: (alias: string, target: string) => void;
  baseUrl: string;
  hasActiveProviders: boolean;
  apiKeys: ApiKey[];
  cloudEnabled: boolean;
  initialStatus?: StatusData | null;
  tunnelEnabled: boolean;
  tunnelPublicUrl: string;
  tailscaleEnabled: boolean;
  tailscaleUrl: string;
}

export default function ClaudeToolCard({
  tool, isExpanded, onToggle, activeProviders, modelMappings, onModelMappingChange,
  baseUrl, hasActiveProviders, apiKeys, cloudEnabled, initialStatus,
  tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl,
}: ClaudeToolCardProps) {
  const [claudeStatus, setClaudeStatus] = useState<StatusData | null>(initialStatus || null);
  const [checkingClaude, setCheckingClaude] = useState<boolean>(false);
  const [applying, setApplying] = useState<boolean>(false);
  const [restoring, setRestoring] = useState<boolean>(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [showInstallGuide, setShowInstallGuide] = useState<boolean>(false);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [currentEditingAlias, setCurrentEditingAlias] = useState<string | null>(null);
  const [selectedApiKey, setSelectedApiKey] = useState<string>("");
  const [showManualConfigModal, setShowManualConfigModal] = useState<boolean>(false);
  const [customBaseUrl, setCustomBaseUrl] = useState<string>("");
  const [ccFilterNaming, setCcFilterNaming] = useState<boolean>(false);
  const [exaMcpEnabled, setExaMcpEnabled] = useState<boolean>(false);
  const [maxContextTokens, setMaxContextTokens] = useState<string>("");
  const hasInitializedModels = useRef(false);
  const { modelAliases, fetchModelAliases } = useModelAliases();

  const getConfigStatus = () => {
    if (!claudeStatus?.installed) return null;
    const currentUrl = claudeStatus.settings?.env?.ANTHROPIC_BASE_URL;
    if (!currentUrl) return "not_configured";
    if (matchKnownEndpoint(currentUrl, { tunnelPublicUrl, tailscaleUrl, cloudUrl: cloudEnabled ? CLOUD_URL : null })) return "configured";
    return "other";
  };

  const configStatus = getConfigStatus();

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) {
      setSelectedApiKey(apiKeys[0].key);
    }
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (initialStatus) {
      setClaudeStatus(initialStatus);
      setExaMcpEnabled(!!initialStatus.exaMcpEnabled);
    }
  }, [initialStatus]);

  useEffect(() => {
    const v = claudeStatus?.settings?.env?.CLAUDE_CODE_MAX_CONTEXT_TOKENS;
    setMaxContextTokens(v || "");
  }, [claudeStatus?.settings?.env?.CLAUDE_CODE_MAX_CONTEXT_TOKENS]);

  useEffect(() => {
    if (isExpanded) {
      if (!claudeStatus) checkClaudeStatus();
      fetchModelAliases();
    }
  }, [claudeStatus, fetchModelAliases, isExpanded]);

  useEffect(() => {
    fetch("/api/settings").then(r => r.json()).then(data => {
      setCcFilterNaming(!!data.ccFilterNaming);
    }).catch(() => {});
  }, []);

  const handleCcFilterNamingToggle = async (checked: boolean | "indeterminate") => {
    const value = checked === true;
    setCcFilterNaming(value);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ccFilterNaming: value }),
    }).catch(() => {});
  };

  useEffect(() => {
    if (claudeStatus?.installed && !hasInitializedModels.current) {
      hasInitializedModels.current = true;
      const env = claudeStatus.settings?.env || {};
      tool.defaultModels.forEach((model) => {
        if (model.envKey) {
          const value = env[model.envKey] || model.defaultValue || "";
          if (value) onModelMappingChange(model.alias, value);
        }
      });
      const tokenFromFile = env.ANTHROPIC_AUTH_TOKEN;
      if (tokenFromFile && apiKeys?.some(k => k.key === tokenFromFile)) {
        setSelectedApiKey(tokenFromFile);
      }
    }
  }, [claudeStatus, apiKeys, tool.defaultModels, onModelMappingChange]);

  const checkClaudeStatus = async () => {
    setCheckingClaude(true);
    try {
      const res = await fetch("/api/cli-tools/claude-settings");
      const data = await res.json();
      setClaudeStatus(data);
      setExaMcpEnabled(!!data.exaMcpEnabled);
    } catch  {
      setClaudeStatus({ installed: false });
    } finally {
      setCheckingClaude(false);
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

  const handleApplySettings = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const env: Record<string, string> = { ANTHROPIC_BASE_URL: getEffectiveBaseUrl() };
      const keyToUse = selectedApiKey?.trim()
        || (apiKeys?.length > 0 ? apiKeys[0].key : null)
        || (!cloudEnabled ? "sk_modelhub" : null);
      if (keyToUse) env.ANTHROPIC_AUTH_TOKEN = keyToUse;
      tool.defaultModels.forEach((model) => {
        const targetModel = modelMappings[model.alias];
        if (targetModel && model.envKey) env[model.envKey] = targetModel;
      });
      if (maxContextTokens) env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = maxContextTokens;
      const res = await fetch("/api/cli-tools/claude-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ env, exaMcpEnabled, maxContextTokens }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings applied successfully!" });
        setClaudeStatus(prev => ({ ...prev, hasBackup: true, settings: { ...prev?.settings, env }, exaMcpEnabled } as StatusData));
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
      const res = await fetch("/api/cli-tools/claude-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        tool.defaultModels.forEach((model) => onModelMappingChange(model.alias, model.defaultValue || ""));
        setSelectedApiKey("");
        setExaMcpEnabled(false);
        setMaxContextTokens("");
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: (error as Error).message });
    } finally {
      setRestoring(false);
    }
  };

  const openModelSelector = (alias: string) => {
    setCurrentEditingAlias(alias);
    setModalOpen(true);
  };

  const handleModelSelect = (model: { value: string }) => {
    if (currentEditingAlias) onModelMappingChange(currentEditingAlias, model.value);
  };

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_modelhub" : "<API_KEY_FROM_DASHBOARD>");
    const env: Record<string, string> = { ANTHROPIC_BASE_URL: getEffectiveBaseUrl(), ANTHROPIC_AUTH_TOKEN: keyToUse };
    tool.defaultModels.forEach((model) => {
      const targetModel = modelMappings[model.alias];
      if (targetModel && model.envKey) env[model.envKey] = targetModel;
    });
    if (maxContextTokens) env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = maxContextTokens;
    return [{ filename: "~/.claude/settings.json", content: JSON.stringify({ hasCompletedOnboarding: true, env }, null, 2) }];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src="/providers/claude.png" alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} loading="lazy" decoding="async" />
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
          {checkingClaude && (
            <div className="flex items-center gap-2 text-text-muted">
              <Loader2 className="size-4" />
              <span>Checking Claude CLI...</span>
            </div>
          )}

          {!checkingClaude && claudeStatus && !claudeStatus.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <TriangleAlert className="size-4" />
                  <div className="flex-1">
                    <p className="font-medium text-yellow-600 dark:text-yellow-400">Claude CLI not detected locally</p>
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
                  <div className="flex flex-col gap-3 text-sm">
                    <div>
                      <p className="text-text-muted mb-1">macOS / Linux / Windows:</p>
                      <code className="block px-3 py-2 bg-black/5 dark:bg-white/5 rounded font-mono text-xs">npm install -g @anthropic-ai/claude-code</code>
                    </div>
                    <p className="text-text-muted">After installation, run <code className="px-1 bg-black/5 dark:bg-white/5 rounded">claude</code> to verify.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {!checkingClaude && claudeStatus?.installed && (
            <>
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Select Endpoint</span>
                  <ArrowRight className="size-4" />
                  <BaseUrlSelect value={customBaseUrl || getDisplayUrl()} onChange={setCustomBaseUrl} requiresExternalUrl={tool.requiresExternalUrl} tunnelEnabled={tunnelEnabled} tunnelPublicUrl={tunnelPublicUrl} tailscaleEnabled={tailscaleEnabled} tailscaleUrl={tailscaleUrl} />
                </div>

                {claudeStatus?.settings?.env?.ANTHROPIC_BASE_URL && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Current</span>
                    <ArrowRight className="size-4" />
                    <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">{claudeStatus.settings.env.ANTHROPIC_BASE_URL}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">API Key</span>
                  <ArrowRight className="size-4" />
                  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                {tool.defaultModels.map((model) => (
                  <div key={model.alias} className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">{model.name}</span>
                    <ArrowRight className="size-4" />
                    <div className="relative w-full min-w-0">
                      <Input type="text" value={modelMappings[model.alias] || ""} onChange={(e) => onModelMappingChange(model.alias, e.target.value)} placeholder="provider/model-id" className="w-full min-w-0 pl-2 pr-7 py-2 text-xs sm:py-1.5" />
                      {modelMappings[model.alias] && <Button variant="ghost" size="sm" onClick={() => onModelMappingChange(model.alias, "")} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-red-500" title="Clear"><X className="size-4" /></Button>}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => openModelSelector(model.alias)} disabled={!hasActiveProviders} className="w-full sm:w-auto">Select Model</Button>
                  </div>
                ))}

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Context window</span>
                  <ArrowRight className="size-4" />
                  <Select value={maxContextTokens} onValueChange={(val) => setMaxContextTokens(val ?? "")}>
                    <SelectTrigger className="w-full min-w-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTEXT_OPTIONS.map((opt) => (
                        <SelectItem key={opt.label} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Filter naming</span>
                  <ArrowRight className="size-4" />
                  <Label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <Checkbox checked={ccFilterNaming} onCheckedChange={handleCcFilterNamingToggle} />
                    <span className="text-xs text-text-muted">Filter naming requests</span>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger render={<span className="inline-flex" />}>
                          <Info className="size-4" />
                        </TooltipTrigger>
                        <TooltipContent>{"Intercepts Claude Code's topic-naming requests and returns a fake response locally, saving API tokens."}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Web Search</span>
                  <ArrowRight className="size-4" />
                  <Label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <Checkbox checked={exaMcpEnabled} onCheckedChange={(checked) => setExaMcpEnabled(checked === true)} />
                    <span className="text-xs text-text-muted">Exa MCP</span>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger render={<span className="inline-flex" />}>
                          <Info className="size-4" />
                        </TooltipTrigger>
                        <TooltipContent>Injects Exa MCP into ~/.claude.json so non-Claude models gain web search. Restart Claude Code after Apply.</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                </div>
              </div>

              <StatusMessage message={message} />

              <ActionButtons
                onApply={handleApplySettings}
                applyDisabled={!hasActiveProviders}
                applyLoading={applying}
                onReset={handleResetSettings}
                resetDisabled={!claudeStatus?.hasModelHub}
                resetLoading={restoring}
                onManualConfig={() => setShowManualConfigModal(true)}
              />
            </>
          )}
        </div>
      )}

      {modalOpen && (
        <ModelSelectModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSelect={handleModelSelect} selectedModel={currentEditingAlias ? modelMappings[currentEditingAlias] : undefined} activeProviders={activeProviders} modelAliases={modelAliases} title={`Select model for ${currentEditingAlias}`} />
      )}

      <ManualConfigModal isOpen={showManualConfigModal} onClose={() => setShowManualConfigModal(false)} title="Claude CLI - Manual Configuration" configs={getManualConfigs()} />
    </Card>
  );
}



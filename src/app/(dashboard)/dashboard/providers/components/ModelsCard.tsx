"use client";

import { useState, useCallback, useEffect } from "react";
import { Card, Button, Modal } from "@/shared/components";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { getProviderAlias } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { Beaker, Bot, Check, CheckCircle2, Copy, Loader2, Plus, X } from "lucide-react";
import { translate } from "@/i18n/runtime";

// ── ModelRow ───────────────────────────────────────────────────
interface ModelRowProps {
  model: { id: string; name?: string };
  fullModel: string;
  copied?: string;
  onCopy: (text: string, id: string) => void;
  testStatus?: "ok" | "error";
  isCustom?: boolean;
  isFree?: boolean;
  onDeleteAlias?: () => void;
  onTest?: () => void;
  isTesting?: boolean;
}

function ModelRow({ model, fullModel, copied, onCopy, testStatus, isCustom, isFree, onDeleteAlias, onTest, isTesting }: ModelRowProps) {
  const borderColor = testStatus === "ok" ? "border-green-500/40" : testStatus === "error" ? "border-red-500/40" : "border-border";
  const iconColor = testStatus === "ok" ? "#22c55e" : testStatus === "error" ? "#ef4444" : undefined;

  return (
    <div className={`group px-3 py-2 rounded-lg border ${borderColor} hover:bg-sidebar/50`}>
      <div className="flex items-center gap-2">
        <span className="text-base" style={iconColor ? { color: iconColor } : undefined}>
          {testStatus === "ok" ? <CheckCircle2 className="size-4" /> : testStatus === "error" ? <X className="size-4" /> : <Bot className="size-4" />}
        </span>
        <div className="flex flex-col gap-1">
          <code className="text-xs text-text-muted font-mono bg-sidebar px-1.5 py-0.5 rounded">{fullModel}</code>
          {model.name && <span className="text-[9px] text-text-muted/70 italic pl-1">{model.name}</span>}
        </div>
        {onTest && (
          <div className="relative group/btn">
            <Button variant="ghost" size="icon-sm" onClick={onTest} disabled={isTesting} className={`${isTesting ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
              <span className="text-sm" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                {isTesting ? <Loader2 className="size-4" /> : <Beaker className="size-4" />}
              </span>
            </Button>
            <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {isTesting ? translate("Testing...") : translate("Test")}
            </span>
          </div>
        )}
        <div className="relative group/btn">
          <Button variant="ghost" size="icon-sm" onClick={() => onCopy(fullModel, `model-${model.id}`)}>
            <span className="text-sm">{copied === `model-${model.id}` ? <Check className="size-4" /> : <Copy className="size-4" />}</span>
          </Button>
          <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
            {copied === `model-${model.id}` ? "Copied!" : "Copy"}
          </span>
        </div>
        {isFree && <span className="text-[10px] font-bold text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded">FREE</span>}
        {isCustom && (
          <Button variant="ghost" size="icon-sm" onClick={onDeleteAlias} className="text-red-500 opacity-0 group-hover:opacity-100 ml-auto" title="Remove custom model">
            <X className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ── AddCustomModelModal ────────────────────────────────────────
interface AddCustomModelModalProps {
  isOpen: boolean;
  onSave: (modelId: string) => Promise<void>;
  onClose: () => void;
}

function AddCustomModelModal({ isOpen, onSave, onClose }: AddCustomModelModalProps) {
  const [modelId, setModelId] = useState<string>("");

  const handleSave = () => {
    if (!modelId.trim()) return;
    onSave(modelId.trim());
    setModelId("");
  };

  return (
    <Modal isOpen={isOpen} title={translate("Add Custom Model") || "Add Custom Model"} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <Label className="text-xs text-text-muted mb-1 block">{translate("Model ID")}</Label>
          <Input
            className="w-full px-3 py-2 text-sm"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder="e.g. tts-1-hd"
            autoFocus
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSave} fullWidth disabled={!modelId.trim()}>{translate("Add")}</Button>
          <Button onClick={onClose} variant="ghost" fullWidth>{translate("Cancel")}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── ModelsCard ─────────────────────────────────────────────────
// Self-contained card: shows models for a provider, filtered by optional `kindFilter`.
// kindFilter: if provided, only shows models with matching type/kinds field.
interface BuiltInModel {
  id: string;
  name?: string;
  isFree?: boolean;
  kinds?: string[];
  [key: string]: unknown;
}

interface CustomModel {
  id: string;
  name?: string;
  providerAlias: string;
  type?: string;
  kinds?: string[];
  [key: string]: unknown;
}

interface ModelsCardProps {
  providerId: string;
  kindFilter?: string;
  providerAliasOverride?: string;
}

export default function ModelsCard({ providerId, kindFilter, providerAliasOverride }: ModelsCardProps) {
  const { copied, copy } = useCopyToClipboard();
  const [modelAliases, setModelAliases] = useState<Record<string, string>>({});
  const [customModels, setCustomModels] = useState<CustomModel[]>([]);
  const [modelTestResults, setModelTestResults] = useState<Record<string, "ok" | "error">>({});
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [testError, setTestError] = useState<string>("");
  const [showAddCustomModel, setShowAddCustomModel] = useState<boolean>(false);

  const providerAlias = providerAliasOverride || getProviderAlias(providerId);
  const effectiveType = kindFilter || "llm";

  const fetchData = useCallback(async () => {
    try {
      const [aliasRes, customRes] = await Promise.all([
        fetch("/api/models/alias"),
        fetch("/api/models/custom", { cache: "no-store" }),
      ]);
      const aliasData = await aliasRes.json();
      const customData = await customRes.json();
      if (aliasRes.ok) setModelAliases(aliasData.aliases || {});
      if (customRes.ok) setCustomModels(customData.models || []);
    } catch (e) { console.error("ModelsCard fetch error:", e); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSetAlias = async (modelId: string, alias: string) => {
    const fullModel = `${providerAlias}/${modelId}`;
    try {
      const res = await fetch("/api/models/alias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: fullModel, alias }),
      });
      if (res.ok) await fetchData();
    } catch (e) { console.error("set alias error:", e); }
  };

  const handleDeleteAlias = async (alias: string) => {
    try {
      const res = await fetch(`/api/models/alias?alias=${encodeURIComponent(alias)}`, { method: "DELETE" });
      if (res.ok) await fetchData();
    } catch (e) { console.error("delete alias error:", e); }
  };

  const handleAddCustomModel = async (modelId: string) => {
    try {
      const res = await fetch("/api/models/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias, id: modelId, type: effectiveType }),
      });
      if (res.ok) {
        await fetchData();
        window.dispatchEvent(new CustomEvent("customModelChanged"));
      }
    } catch (e) { console.error("add custom model error:", e); }
  };

  const handleDeleteCustomModel = async (modelId: string) => {
    try {
      const params = new URLSearchParams({ providerAlias, id: modelId, type: effectiveType });
      const res = await fetch(`/api/models/custom?${params}`, { method: "DELETE" });
      if (res.ok) {
        await fetchData();
        window.dispatchEvent(new CustomEvent("customModelChanged"));
      }
    } catch (e) { console.error("delete custom model error:", e); }
  };

  const handleTestModel = async (modelId: string) => {
    if (testingModelId) return;
    setTestingModelId(modelId);
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerAlias}/${modelId}`, kind: kindFilter }),
      });
      const data = await res.json();
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
      setTestError(data.ok ? "" : (data.error || "Model not reachable"));
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
      setTestError("Network error");
    } finally { setTestingModelId(null); }
  };

  // Built-in models — filter by kindFilter if provided
  const allBuiltIn = getModelsByProviderId(providerId) as unknown as BuiltInModel[];
  const builtInModels = kindFilter
    ? allBuiltIn.filter((m: BuiltInModel) => {
        if (m.kinds) return m.kinds.includes(kindFilter);
        return getModelKind(m, "llm") === kindFilter;
      })
    : allBuiltIn;

  // Custom models for this provider + kind, dedupe vs built-in
  const myCustomModels = customModels.filter(
    (m) => m.providerAlias === providerAlias
      && getModelKind(m, "llm") === effectiveType
      && !builtInModels.some((b: BuiltInModel) => b.id === m.id)
  );

  const displayModels = builtInModels;

  return (
    <>
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{translate("Models")}{kindFilter ? ` — ${kindFilter.toUpperCase()}` : ""}</h2>
        </div>
        {testError && <p className="text-xs text-red-500 mb-3 break-words">{testError}</p>}

        <div className="flex flex-wrap gap-3">
          {displayModels.map((model: BuiltInModel) => {
            const fullModel = `${providerAlias}/${model.id}`;
            const existingAlias = Object.entries(modelAliases).find(([, m]) => m === fullModel)?.[0];
            return (
              <ModelRow
                key={model.id}
                model={model}
                fullModel={`${providerAlias}/${model.id}`}
                copied={copied ?? undefined}
                onCopy={copy}
                onDeleteAlias={() => handleDeleteAlias(existingAlias!)}
                testStatus={modelTestResults[model.id]}
                onTest={() => handleTestModel(model.id)}
                isTesting={testingModelId === model.id}
                isFree={model.isFree}
              />
            );
          })}

          {myCustomModels.map((model) => (
            <ModelRow
              key={`${model.id}-${model.type}`}
              model={{ id: model.id, name: model.name }}
              fullModel={`${providerAlias}/${model.id}`}
              copied={copied ?? undefined}
              onCopy={copy}
              onDeleteAlias={() => handleDeleteCustomModel(model.id)}
              testStatus={modelTestResults[model.id]}
              onTest={() => handleTestModel(model.id)}
              isTesting={testingModelId === model.id}
              isCustom
            />
          ))}

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddCustomModel(true)}
            className="border-dashed border-black/15 dark:border-white/15 text-xs"
          >
            <Plus className="size-4" />
            {translate("Add Model")}
          </Button>
        </div>
      </Card>

      <AddCustomModelModal
        isOpen={showAddCustomModel}
        onSave={async (modelId) => {
          await handleAddCustomModel(modelId);
          setShowAddCustomModel(false);
        }}
        onClose={() => setShowAddCustomModel(false)}
      />
    </>
  );
}

"use client";

import { useState, useCallback, useEffect } from "react";
import { Card, Button, Modal } from "@/shared/components";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { getProviderAlias } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { Plus } from "lucide-react";
import { translate } from "@/i18n/runtime";
import CardModelRow from "./CardModelRow";

interface BuiltInModel { id: string; name?: string; isFree?: boolean; kinds?: string[]; [key: string]: unknown; }
interface CustomModel { id: string; name?: string; providerAlias: string; type?: string; kinds?: string[]; [key: string]: unknown; }

export default function ModelsCard({ providerId, kindFilter, providerAliasOverride }: { providerId: string; kindFilter?: string; providerAliasOverride?: string }) {
  const { copied, copy } = useCopyToClipboard();
  const [modelAliases, setModelAliases] = useState<Record<string, string>>({});
  const [customModels, setCustomModels] = useState<CustomModel[]>([]);
  const [modelTestResults, setModelTestResults] = useState<Record<string, "ok" | "error">>({});
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [testError, setTestError] = useState<string>("");
  const [showAddCustomModel, setShowAddCustomModel] = useState<boolean>(false);
  const [newModelId, setNewModelId] = useState<string>("");

  const providerAlias = providerAliasOverride || getProviderAlias(providerId);
  const effectiveType = kindFilter || "llm";

  const fetchData = useCallback(async () => {
    try {
      const [aliasRes, customRes] = await Promise.all([fetch("/api/models/alias"), fetch("/api/models/custom", { cache: "no-store" })]);
      if (aliasRes.ok) setModelAliases((await aliasRes.json()).aliases || {});
      if (customRes.ok) setCustomModels((await customRes.json()).models || []);
    } catch (e) { console.error("ModelsCard fetch error:", e); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDeleteAlias = async (alias: string) => {
    try { const res = await fetch(`/api/models/alias?alias=${encodeURIComponent(alias)}`, { method: "DELETE" }); if (res.ok) await fetchData(); }
    catch (e) { console.error("delete alias error:", e); }
  };

  const handleAddCustomModel = async (modelId: string) => {
    try {
      const res = await fetch("/api/models/custom", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerAlias, id: modelId, type: effectiveType }) });
      if (res.ok) { await fetchData(); window.dispatchEvent(new CustomEvent("customModelChanged")); }
    } catch (e) { console.error("add custom model error:", e); }
  };

  const handleDeleteCustomModel = async (modelId: string) => {
    try {
      const params = new URLSearchParams({ providerAlias, id: modelId, type: effectiveType });
      const res = await fetch(`/api/models/custom?${params}`, { method: "DELETE" });
      if (res.ok) { await fetchData(); window.dispatchEvent(new CustomEvent("customModelChanged")); }
    } catch (e) { console.error("delete custom model error:", e); }
  };

  const handleTestModel = async (modelId: string) => {
    if (testingModelId) return;
    setTestingModelId(modelId);
    try {
      const res = await fetch("/api/models/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: `${providerAlias}/${modelId}`, kind: kindFilter }) });
      const data = await res.json();
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
      setTestError(data.ok ? "" : (data.error || "Model not reachable"));
    } catch { setModelTestResults((prev) => ({ ...prev, [modelId]: "error" })); setTestError("Network error"); }
    finally { setTestingModelId(null); }
  };

  const allBuiltIn = getModelsByProviderId(providerId) as unknown as BuiltInModel[];
  const builtInModels = kindFilter ? allBuiltIn.filter((m) => m.kinds ? m.kinds.includes(kindFilter) : getModelKind(m, "llm") === kindFilter) : allBuiltIn;
  const myCustomModels = customModels.filter((m) => m.providerAlias === providerAlias && getModelKind(m, "llm") === effectiveType && !builtInModels.some((b) => b.id === m.id));

  return (
    <>
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{translate("Models")}{kindFilter ? ` — ${kindFilter.toUpperCase()}` : ""}</h2>
        </div>
        {testError && <p className="text-xs text-red-500 mb-3 break-words">{testError}</p>}
        <div className="flex flex-wrap gap-3">
          {builtInModels.map((model) => {
            const fullModel = `${providerAlias}/${model.id}`;
            const existingAlias = Object.entries(modelAliases).find(([, m]) => m === fullModel)?.[0];
            return <CardModelRow key={model.id} model={model} fullModel={fullModel} copied={copied ?? undefined} onCopy={copy} onDeleteAlias={() => handleDeleteAlias(existingAlias!)} testStatus={modelTestResults[model.id]} onTest={() => handleTestModel(model.id)} isTesting={testingModelId === model.id} isFree={model.isFree} />;
          })}
          {myCustomModels.map((model) => (
            <CardModelRow key={`${model.id}-${model.type}`} model={{ id: model.id, name: model.name }} fullModel={`${providerAlias}/${model.id}`} copied={copied ?? undefined} onCopy={copy} onDeleteAlias={() => handleDeleteCustomModel(model.id)} testStatus={modelTestResults[model.id]} onTest={() => handleTestModel(model.id)} isTesting={testingModelId === model.id} isCustom />
          ))}
          <Button variant="outline" size="sm" onClick={() => setShowAddCustomModel(true)} className="border-dashed border-black/15 dark:border-white/15 text-xs">
            <Plus className="size-4" />{translate("Add Model")}
          </Button>
        </div>
      </Card>
      <Modal isOpen={showAddCustomModel} title={translate("Add Custom Model") || "Add Custom Model"} onClose={() => setShowAddCustomModel(false)}>
        <div className="flex flex-col gap-4">
          <div>
            <Label className="text-xs text-text-muted mb-1 block">{translate("Model ID")}</Label>
            <Input className="w-full px-3 py-2 text-sm" value={newModelId} onChange={(e) => setNewModelId(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newModelId.trim()) { handleAddCustomModel(newModelId.trim()); setShowAddCustomModel(false); setNewModelId(""); } }} placeholder="e.g. tts-1-hd" autoFocus />
          </div>
          <div className="flex gap-2">
            <Button onClick={async () => { if (newModelId.trim()) { await handleAddCustomModel(newModelId.trim()); setShowAddCustomModel(false); setNewModelId(""); } }} fullWidth disabled={!newModelId.trim()}>{translate("Add")}</Button>
            <Button onClick={() => setShowAddCustomModel(false)} variant="ghost" fullWidth>{translate("Cancel")}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

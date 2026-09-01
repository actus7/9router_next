"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getProviderCustomModelRows } from "@/shared/utils/providerCustomModels";
import { Download, Plus } from "lucide-react";
import { useNotificationStore } from "@/store/notificationStore";
import { translate } from "@/i18n/runtime";
import CompatibleModelRow from "./components/CompatibleModelRow";
import { importModelsFromEndpoint, testCompatibleModel } from "./compatibleModelHelpers";

interface Connection { id: string; isActive?: boolean; }
interface CustomModel { id: string; providerAlias?: string; kind?: string; type?: string; }

interface CompatibleModelsSectionProps {
  providerStorageAlias: string;
  providerDisplayAlias: string;
  modelAliases: Record<string, string>;
  customModels?: CustomModel[];
  copied?: string;
  onCopy: (text: string, id: string) => void;
  onDeleteAlias: (alias: string) => void;
  onAddCustomModel: (modelId: string) => Promise<void>;
  onDeleteCustomModel: (modelId: string) => void;
  connections: Connection[];
  isAnthropic?: boolean;
}

export default function CompatibleModelsSection({ providerStorageAlias, providerDisplayAlias, modelAliases, customModels, copied, onCopy, onDeleteAlias, onAddCustomModel, onDeleteCustomModel, connections, isAnthropic }: CompatibleModelsSectionProps) {
  const notify = useNotificationStore();
  const [newModel, setNewModel] = useState<string>("");
  const [adding, setAdding] = useState<boolean>(false);
  const [importing, setImporting] = useState<boolean>(false);
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [modelTestResults, setModelTestResults] = useState<Record<string, "ok" | "error">>({});

  const allModels = getProviderCustomModelRows({ customModels, modelAliases, providerAlias: providerStorageAlias, type: "llm" });

  const handleTestModel = async (modelId: string) => {
    if (testingModelId) return;
    setTestingModelId(modelId);
    const result = await testCompatibleModel(providerStorageAlias, modelId);
    setModelTestResults((prev) => ({ ...prev, [modelId]: result }));
    setTestingModelId(null);
  };

  const handleAdd = async () => {
    if (!newModel.trim() || adding) return;
    const modelId = newModel.trim();
    if (allModels.some((model: { id: string }) => model.id === modelId)) {
      notify.warning(translate("Model already exists for this provider.") || "Model already exists for this provider.");
      return;
    }
    setAdding(true);
    try { await onAddCustomModel(modelId); setNewModel(""); }
    catch (error) { console.error("Error adding model:", error); }
    finally { setAdding(false); }
  };

  const handleImport = async () => {
    if (importing) return;
    setImporting(true);
    try { await importModelsFromEndpoint(connections, allModels, onAddCustomModel, notify); }
    catch (error) { console.error("Error importing models:", error); }
    finally { setImporting(false); }
  };

  const canImport = connections.some((conn) => conn.isActive !== false);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        {translate("Add compatible models with")} {isAnthropic ? "Anthropic" : "OpenAI"} {translate("manually or import from /models endpoint.")}
      </p>
      <div className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <Label htmlFor="new-compatible-model-input" className="text-xs text-text-muted mb-1 block">{translate("Model ID")}</Label>
          <Input id="new-compatible-model-input" type="text" value={newModel} onChange={(e) => setNewModel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAdd()} placeholder={isAnthropic ? "claude-3-opus-20240229" : "gpt-4o"} className="w-full px-3 py-2 text-sm" />
        </div>
        <Button size="sm" icon={<Plus className="size-4" />} onClick={handleAdd} disabled={!newModel.trim() || adding}>{adding ? translate("Adding...") : translate("Add")}</Button>
        <Button size="sm" variant="secondary" icon={<Download className="size-4" />} onClick={handleImport} disabled={!canImport || importing}>{importing ? translate("Importing...") : translate("Import from /models")}</Button>
      </div>
      {!canImport && <p className="text-xs text-text-muted">{translate("Add a connection to enable importing models.")}</p>}
      {allModels.length > 0 && (
        <div className="flex flex-col gap-3">
          {allModels.map(({ id, alias, source }: { id: string; alias?: string; source: string }) => (
            <CompatibleModelRow key={`${source}-${providerStorageAlias}/${id}`} modelId={id} fullModel={`${providerDisplayAlias}/${id}`} copied={copied} onCopy={onCopy} onDeleteAlias={() => source === "custom" ? onDeleteCustomModel(id) : onDeleteAlias(alias!)} onTest={connections.length > 0 ? () => handleTestModel(id) : undefined} testStatus={modelTestResults[id]} isTesting={testingModelId === id} />
          ))}
        </div>
      )}
    </div>
  );
}

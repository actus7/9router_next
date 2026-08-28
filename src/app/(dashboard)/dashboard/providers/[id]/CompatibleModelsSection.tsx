"use client";

import { useState } from "react";
import { Button } from "@/shared/components";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getProviderCustomModelRows } from "@/shared/utils/providerCustomModels";
import { Beaker, Bot, Check, CheckCircle2, Copy, Download, Loader2, Plus, Trash2, X } from "lucide-react";
import { useNotificationStore } from "@/store/notificationStore";

interface CompatibleModelRowProps {
  modelId: string;
  fullModel: string;
  copied?: string;
  onCopy: (text: string, id: string) => void;
  onDeleteAlias: () => void;
  onTest?: () => void;
  testStatus?: "ok" | "error";
  isTesting?: boolean;
}

function CompatibleModelRow({ modelId, fullModel, copied, onCopy, onDeleteAlias, onTest, testStatus, isTesting }: CompatibleModelRowProps) {
  const borderColor = testStatus === "ok"
    ? "border-green-500/40"
    : testStatus === "error"
    ? "border-red-500/40"
    : "border-border";

  const iconColor = testStatus === "ok"
    ? "#22c55e"
    : testStatus === "error"
    ? "#ef4444"
    : undefined;

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${borderColor} hover:bg-sidebar/50`}>
      <span
        className="text-base text-text-muted"
        style={iconColor ? { color: iconColor } : undefined}
      >
        {testStatus === "ok" ? <CheckCircle2 className="size-4" /> : testStatus === "error" ? <X className="size-4" /> : <Bot className="size-4" />}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{modelId}</p>
        <div className="flex items-center gap-1 mt-1">
          <code className="text-xs text-text-muted font-mono bg-sidebar px-1.5 py-0.5 rounded">{fullModel}</code>
          <div className="relative group/btn">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onCopy(fullModel, `model-${modelId}`)}
            >
              <span className="text-sm">
                {copied === `model-${modelId}` ? <Check className="size-4" /> : <Copy className="size-4" />}
              </span>
            </Button>
            <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {copied === `model-${modelId}` ? "Copied!" : "Copy"}
            </span>
          </div>
          {onTest && (
            <div className="relative group/btn">
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={onTest}
                disabled={isTesting}
              >
                <span className="text-sm" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                  {isTesting ? <Loader2 className="size-4" /> : <Beaker className="size-4" />}
                </span>
              </Button>
              <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
                {isTesting ? "Testando..." : "Testar"}
              </span>
            </div>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onDeleteAlias}
        className="text-red-500 hover:bg-red-50 hover:text-red-500"
        title="Remove model"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

interface Connection {
  id: string;
  isActive?: boolean;
}

interface CustomModel {
  id: string;
  providerAlias?: string;
  kind?: string;
  type?: string;
}

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

  const handleTestModel = async (modelId: string) => {
    if (testingModelId) return;
    setTestingModelId(modelId);
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}` }),
      });
      const data = await res.json();
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
    } finally {
      setTestingModelId(null);
    }
  };

  const allModels = getProviderCustomModelRows({
    customModels,
    modelAliases,
    providerAlias: providerStorageAlias,
    type: "llm",
  });

  const handleAdd = async () => {
    if (!newModel.trim() || adding) return;
    const modelId = newModel.trim();
    if (allModels.some((model: { id: string }) => model.id === modelId)) {
      notify.warning("Modelo já existe para este provedor.");
      return;
    }

    setAdding(true);
    try {
      await onAddCustomModel(modelId);
      setNewModel("");
    } catch (error) {
      console.error("Error adding model:", error);
    } finally {
      setAdding(false);
    }
  };

  const handleImport = async () => {
    if (importing) return;
    const activeConnection = connections.find((conn) => conn.isActive !== false);
    if (!activeConnection) return;

    setImporting(true);
    try {
      const res = await fetch(`/api/providers/${activeConnection.id}/models`);
      const data = await res.json();
      if (!res.ok) {
        notify.error(data.error || "Falha ao importar modelos");
        return;
      }
      const models = data.models || [];
      if (models.length === 0) {
        notify.warning("Nenhum modelo retornado de /models.");
        return;
      }
      let importedCount = 0;
      for (const model of models) {
        const modelId = model.id || model.name || model.model;
        if (!modelId) continue;
        if (allModels.some((entry: { id: string }) => entry.id === modelId)) continue;
        await onAddCustomModel(modelId);
        importedCount += 1;
      }
      if (importedCount === 0) {
        notify.warning("Nenhum modelo novo foi adicionado.");
      }
    } catch (error) {
      console.error("Error importing models:", error);
    } finally {
      setImporting(false);
    }
  };

  const canImport = connections.some((conn) => conn.isActive !== false);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        Adicione modelos compatíveis com {isAnthropic ? "Anthropic" : "OpenAI"} manualmente ou importe-os do endpoint /models.
      </p>

      <div className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <Label htmlFor="new-compatible-model-input" className="text-xs text-text-muted mb-1 block">ID do Modelo</Label>
          <Input
            id="new-compatible-model-input"
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder={isAnthropic ? "claude-3-opus-20240229" : "gpt-4o"}
            className="w-full px-3 py-2 text-sm"
          />
        </div>
        <Button size="sm" icon={<Plus className="size-4" />} onClick={handleAdd} disabled={!newModel.trim() || adding}>
          {adding ? "Adicionando..." : "Adicionar"}
        </Button>
        <Button size="sm" variant="secondary" icon={<Download className="size-4" />} onClick={handleImport} disabled={!canImport || importing}>
          {importing ? "Importando..." : "Importar de /models"}
        </Button>
      </div>

      {!canImport && (
        <p className="text-xs text-text-muted">
          Adicione uma conexão para habilitar a importação de modelos.
        </p>
      )}

      {allModels.length > 0 && (
        <div className="flex flex-col gap-3">
          {allModels.map(({ id, alias, source }: { id: string; alias?: string; source: string }) => (
            <CompatibleModelRow
              key={`${source}-${providerStorageAlias}/${id}`}
              modelId={id}
              fullModel={`${providerDisplayAlias}/${id}`}
              copied={copied}
              onCopy={onCopy}
              onDeleteAlias={() => source === "custom" ? onDeleteCustomModel(id) : onDeleteAlias(alias!)}
              onTest={connections.length > 0 ? () => handleTestModel(id) : undefined}
              testStatus={modelTestResults[id]}
              isTesting={testingModelId === id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

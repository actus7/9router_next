"use client";

import { useState } from "react";
import { Button } from "@/shared/components";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getProviderCustomModelRows } from "@/shared/utils/providerCustomModels";
import { Beaker, Bot, Check, CheckCircle2, Copy, Loader2, Trash2, X } from "lucide-react";
import { useNotificationStore } from "@/store/notificationStore";

interface PassthroughModelRowProps {
  modelId: string;
  fullModel: string;
  copied?: string;
  onCopy: (text: string, id: string) => void;
  onDeleteAlias: () => void;
  onTest?: () => void;
  testStatus?: "ok" | "error";
  isTesting?: boolean;
}

function PassthroughModelRow({ modelId, fullModel, copied, onCopy, onDeleteAlias, onTest, testStatus, isTesting }: PassthroughModelRowProps) {
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
                {isTesting ? "Testing..." : "Test"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Delete button */}
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

interface CustomModel {
  id: string;
  providerAlias?: string;
  kind?: string;
  type?: string;
}

interface PassthroughModelsSectionProps {
  providerAlias: string;
  modelAliases: Record<string, string>;
  customModels?: CustomModel[];
  copied?: string;
  onCopy: (text: string, id: string) => void;
  onDeleteAlias: (alias: string) => void;
  onAddCustomModel: (modelId: string) => Promise<void>;
  onDeleteCustomModel: (modelId: string) => void;
}

export default function PassthroughModelsSection({ providerAlias, modelAliases, customModels, copied, onCopy, onDeleteAlias, onAddCustomModel, onDeleteCustomModel }: PassthroughModelsSectionProps) {
  const notify = useNotificationStore();
  const [newModel, setNewModel] = useState<string>("");
  const [adding, setAdding] = useState<boolean>(false);

  const allModels = getProviderCustomModelRows({
    customModels,
    modelAliases,
    providerAlias,
    type: "llm",
  });

  const handleAdd = async () => {
    if (!newModel.trim() || adding) return;
    const modelId = newModel.trim();

    if (allModels.some((model: { id: string }) => model.id === modelId)) {
      notify.warning("Model already exists for this provider.");
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

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        OpenRouter supports any model. Add models and create aliases for quick access.
      </p>

      {/* Add new model */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Label htmlFor="new-model-input" className="text-xs text-text-muted mb-1 block">Model ID (from OpenRouter)</Label>
          <Input
            id="new-model-input"
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="anthropic/claude-3-opus"
            className="w-full px-3 py-2 text-sm"
          />
        </div>
        <Button size="sm" icon="add" onClick={handleAdd} disabled={!newModel.trim() || adding}>
          {adding ? "Adding..." : "Add"}
        </Button>
      </div>

      {/* Models list */}
      {allModels.length > 0 && (
        <div className="flex flex-col gap-3">
          {allModels.map(({ id, fullModel, alias, source }: { id: string; fullModel: string; alias?: string; source: string }) => (
            <PassthroughModelRow
              key={`${source}-${fullModel}`}
              modelId={id}
              fullModel={fullModel}
              copied={copied}
              onCopy={onCopy}
              onDeleteAlias={() => source === "custom" ? onDeleteCustomModel(id) : onDeleteAlias(alias!)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

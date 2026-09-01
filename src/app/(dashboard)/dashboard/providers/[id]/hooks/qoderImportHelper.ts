"use client";

import { translate } from "@/i18n/runtime";
import type { Connection, CustomModelEntry } from "../types";

export async function importQoderModels(
  connections: Connection[],
  providerStorageAlias: string,
  customModels: CustomModelEntry[],
  modelAliases: Record<string, string>,
  onAddCustomModel: (modelId: string, type?: string, providerAlias?: string) => Promise<void>,
  notify: { error: (msg: string) => void; warning: (msg: string) => void; success: (msg: string) => void },
): Promise<number> {
  const activeConnection = connections.find((conn) => conn.isActive !== false);
  if (!activeConnection) { notify.error(translate("Please add an active Qoder connection first") || ""); return 0; }

  const res = await fetch(`/api/providers/${activeConnection.id}/models`);
  const data = await res.json();
  if (!res.ok) { notify.error(data.error || translate("Failed to fetch models")); return 0; }
  const fetchedModels = data.models || [];
  if (fetchedModels.length === 0) { notify.warning(translate("No models returned") || ""); return 0; }

  let importedCount = 0;
  for (const model of fetchedModels) {
    const modelId = model.id || model.name;
    if (!modelId) continue;
    const cleanModelId = modelId.replace(/^qoder\//, "");
    const alreadyExists = customModels.some((entry) => entry.providerAlias === providerStorageAlias && entry.id === cleanModelId && (entry.kind || entry.type || "llm") === "llm") || Object.values(modelAliases).includes(`${providerStorageAlias}/${cleanModelId}`);
    if (alreadyExists) continue;
    await onAddCustomModel(cleanModelId, "llm", providerStorageAlias);
    importedCount += 1;
  }

  if (importedCount === 0) notify.warning(translate("All models already exist, no new models added") || "");
  else notify.success(translate("Successfully added") + ` ${importedCount} ` + translate("models"));
  return importedCount;
}

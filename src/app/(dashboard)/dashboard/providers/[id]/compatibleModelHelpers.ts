"use client";

import { translate } from "@/i18n/runtime";

export async function importModelsFromEndpoint(
  connections: Array<{ id: string; isActive?: boolean }>,
  allModels: Array<{ id: string }>,
  onAddCustomModel: (modelId: string) => Promise<void>,
  notify: { error: (msg: string) => void; warning: (msg: string) => void },
): Promise<number> {
  const activeConnection = connections.find((conn) => conn.isActive !== false);
  if (!activeConnection) return 0;

  const res = await fetch(`/api/providers/${activeConnection.id}/models`);
  const data = await res.json();
  if (!res.ok) {
    notify.error(data.error || translate("Failed to import models") || "Failed to import models");
    return 0;
  }
  const models = data.models || [];
  if (models.length === 0) {
    notify.warning(translate("No models returned from /models.") || "No models returned from /models.");
    return 0;
  }
  let importedCount = 0;
  for (const model of models) {
    const modelId = model.id || model.name || model.model;
    if (!modelId) continue;
    if (allModels.some((entry) => entry.id === modelId)) continue;
    await onAddCustomModel(modelId);
    importedCount += 1;
  }
  if (importedCount === 0) notify.warning(translate("No new models were added.") || "No new models were added.");
  return importedCount;
}

export async function testCompatibleModel(
  providerStorageAlias: string,
  modelId: string,
): Promise<"ok" | "error"> {
  try {
    const res = await fetch("/api/models/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}` }),
    });
    const data = await res.json();
    return data.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}

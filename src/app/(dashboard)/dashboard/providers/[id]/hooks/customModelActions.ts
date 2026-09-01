"use client";

import type { CustomModelEntry } from "../types";

export async function addCustomModelApi(
  providerAliasOverride: string,
  modelId: string,
  type: string,
  source: "manual" | "discovered",
  modelData?: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/models/custom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerAlias: providerAliasOverride, id: modelId, type, source,
        name: typeof modelData?.name === "string" ? modelData.name : modelId,
        metadata: modelData,
      }),
    });
    if (res.ok) return { ok: true };
    const data = await res.json();
    return { ok: false, error: data.error || "Failed to add custom model" };
  } catch (error) {
    console.error("Error adding custom model:", error);
    return { ok: false, error: "Failed to add custom model" };
  }
}

export async function deleteCustomModelApi(
  providerAliasOverride: string,
  modelId: string,
  type: string,
): Promise<boolean> {
  try {
    const params = new URLSearchParams({ providerAlias: providerAliasOverride, id: modelId, type });
    const res = await fetch(`/api/models/custom?${params}`, { method: "DELETE" });
    return res.ok;
  } catch (error) {
    console.error("Error deleting custom model:", error);
    return false;
  }
}

export async function deleteAliasApi(alias: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/models/alias?alias=${encodeURIComponent(alias)}`, { method: "DELETE" });
    return res.ok;
  } catch (error) {
    console.error("Error deleting alias:", error);
    return false;
  }
}

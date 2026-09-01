"use client";

import { translate } from "@/i18n/runtime";
import type { Connection } from "../types";

export async function saveApiKey(
  providerId: string,
  formData: Record<string, unknown>,
  fetchConnections: () => Promise<void>,
  setShowAddApiKeyModal: (v: boolean) => void,
  setAddConnectionError: (v: string) => void,
) {
  setAddConnectionError("");
  try {
    const res = await fetch("/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: providerId, providerId, ...formData }),
    });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (res.ok) { await fetchConnections(); setShowAddApiKeyModal(false); return; }
    setAddConnectionError(data?.error || translate("Failed to save connection") || "Failed to save connection");
  } catch (error) {
    console.error("Error saving connection:", error);
    setAddConnectionError(translate("Failed to save connection") || "Failed to save connection");
  }
}

export async function updateConnection(
  selectedConnection: Connection | null,
  formData: Record<string, unknown>,
  fetchConnections: () => Promise<void>,
  setShowEditModal: (v: boolean) => void,
) {
  try {
    const res = await fetch(`/api/providers/${selectedConnection!.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });
    if (res.ok) { await fetchConnections(); setShowEditModal(false); }
  } catch (error) { console.error("Error updating connection:", error); }
}

export async function updateNode(
  providerId: string,
  formData: Record<string, string>,
  fetchConnections: () => Promise<void>,
  setShowEditNodeModal: (v: boolean) => void,
) {
  try {
    const res = await fetch(`/api/provider-nodes/${providerId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });
    if (res.ok) { await fetchConnections(); setShowEditNodeModal(false); }
  } catch (error) { console.error("Error updating provider node:", error); }
}

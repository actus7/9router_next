"use client";

import { useCallback, useState } from "react";
import { translate } from "@/i18n/runtime";
import { notify } from "@/store/notificationStore";
import type { ApiKey, ConfirmState } from "../types";

const failed = (message: string) => notify.error(translate(message) || message);

// A failed GET must not look like an empty list: callers need to tell them apart.
async function fetchKeys(): Promise<ApiKey[]> {
  const res = await fetch("/api/keys");
  if (!res.ok) throw new Error(`Failed to load API keys (${res.status})`);
  const data = await res.json();
  return data.keys || [];
}

export function useApiKeys() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    try {
      let existing = await fetchKeys();
      // Auto-provision a default key for first-time users so the endpoint works out of the box.
      // Only when the list really came back empty: a failed GET is not a first visit.
      if (existing.length === 0) {
        try {
          const createRes = await fetch("/api/keys", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Default Key" }),
          });
          if (createRes.ok) existing = await fetchKeys();
        } catch { /* fall through to empty render */ }
      }
      setKeys(existing);
      setLoadError(false);
    } catch (error) {
      console.error("Error fetching data:", error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;

    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName }),
      });
      const data = await res.json();

      if (res.ok) {
        setCreatedKey(data.key);
        await fetchData();
        setNewKeyName("");
        setShowAddModal(false);
      } else {
        failed("Failed to create API key");
      }
    } catch (error) {
      console.error("Error creating key:", error);
      failed("Failed to create API key");
    }
  };

  const handleDeleteKey = async (id: string) => {
    setConfirmState({
      title: translate("Delete API Key") || "Delete API Key",
      message: translate("Delete this API key?") || "Delete this API key?",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
          if (res.ok) {
            setKeys(keys.filter((k) => k.id !== id));
            setVisibleKeys(prev => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          } else {
            failed("Failed to delete API key");
          }
        } catch (error) {
          console.error("Error deleting key:", error);
          failed("Failed to delete API key");
        }
      }
    });
  };

  const handleToggleKey = async (id: string, isActive: boolean) => {
    try {
      const res = await fetch(`/api/keys/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (res.ok) {
        setKeys(prev => prev.map(k => k.id === id ? { ...k, isActive } : k));
      } else {
        failed("Failed to update API key");
      }
    } catch (error) {
      console.error("Error toggling key:", error);
      failed("Failed to update API key");
    }
  };

  const maskKey = (fullKey: string) => {
    if (!fullKey || fullKey.length <= 10) return fullKey || "";
    return fullKey.slice(0, 6) + "•".repeat(fullKey.length - 10) + fullKey.slice(-4);
  };

  const toggleKeyVisibility = (keyId: string) => {
    setVisibleKeys(prev => {
      const next = new Set(prev);
      if (next.has(keyId)) next.delete(keyId);
      else next.add(keyId);
      return next;
    });
  };

  return {
    keys, setKeys, loading, loadError, showAddModal, setShowAddModal,
    newKeyName, setNewKeyName, createdKey, setCreatedKey,
    confirmState, setConfirmState, visibleKeys,
    fetchData, handleCreateKey, handleDeleteKey, handleToggleKey,
    maskKey, toggleKeyVisibility,
  };
}

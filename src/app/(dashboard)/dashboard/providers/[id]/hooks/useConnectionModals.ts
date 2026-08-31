"use client";

import { useState } from "react";
import { translate } from "@/i18n/runtime";
import { useNotificationStore } from "@/store/notificationStore";
import type { Connection, ConfirmState, ProviderNode } from "../types";

const AG_RISK_STORAGE_KEY = "ag_risk_confirmed";

interface UseConnectionModalsArgs {
  providerId: string;
  initialConnections: Connection[];
  initialProvider: ProviderNode | null;
  isCompatible: boolean;
  fetchConnections: () => Promise<void>;
}

export function useConnectionModals({
  providerId,
  initialConnections,
  initialProvider,
  isCompatible,
  fetchConnections,
}: UseConnectionModalsArgs) {
  const notify = useNotificationStore();
  const [showOAuthModal, setShowOAuthModal] = useState<boolean>(false);
  const [showIFlowCookieModal, setShowIFlowCookieModal] = useState<boolean>(false);
  const [showAddApiKeyModal, setShowAddApiKeyModal] = useState<boolean>(false);
  const [addConnectionError, setAddConnectionError] = useState<string>("");
  const [showBulkImportCodex, setShowBulkImportCodex] = useState<boolean>(false);
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [showEditNodeModal, setShowEditNodeModal] = useState<boolean>(false);
  const [selectedConnection, setSelectedConnection] = useState<Connection | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [showAgRiskModal, setShowAgRiskModal] = useState<boolean>(false);

  const openOAuthConnection = () => {
    setShowOAuthModal(true);
  };

  const triggerOAuthConnection = (isOAuth: boolean) => {
    if (providerId === "antigravity" && typeof window !== "undefined") {
      const confirmed = window.localStorage.getItem(AG_RISK_STORAGE_KEY) === "true";
      if (!confirmed) {
        setShowAgRiskModal(true);
        return;
      }
    }
    if (isOAuth) {
      openOAuthConnection();
      return;
    }
    setAddConnectionError("");
    setShowAddApiKeyModal(true);
  };

  const triggerApiKeyConnection = () => {
    setAddConnectionError("");
    setShowAddApiKeyModal(true);
  };

  const triggerAddConnection = (isOAuth: boolean) => {
    if (isOAuth) {
      triggerOAuthConnection(isOAuth);
      return;
    }
    triggerApiKeyConnection();
  };

  const handleAgRiskConfirm = (isOAuth: boolean) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(AG_RISK_STORAGE_KEY, "true");
    }
    setShowAgRiskModal(false);
    if (isOAuth) {
      openOAuthConnection();
      return;
    }
    triggerApiKeyConnection();
  };

  const handleUpdateNode = async (formData: Record<string, string>) => {
    try {
      const res = await fetch(`/api/provider-nodes/${providerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchConnections();
        setShowEditNodeModal(false);
      }
    } catch (error) {
      console.error("Error updating provider node:", error);
    }
  };

  const handleOAuthSuccess = () => {
    fetchConnections();
    setShowOAuthModal(false);
  };

  const handleIFlowCookieSuccess = () => {
    fetchConnections();
    setShowIFlowCookieModal(false);
  };

  const handleSaveApiKey = async (formData: Record<string, unknown>) => {
    setAddConnectionError("");
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, providerId, ...formData }),
      });

      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (res.ok) {
        await fetchConnections();
        setShowAddApiKeyModal(false);
        return;
      }

      setAddConnectionError(data?.error || translate("Failed to save connection") || "Failed to save connection");
    } catch (error) {
      console.error("Error saving connection:", error);
      setAddConnectionError(translate("Failed to save connection") || "Failed to save connection");
    }
  };

  const handleUpdateConnection = async (formData: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/providers/${selectedConnection!.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        await fetchConnections();
        setShowEditModal(false);
      }
    } catch (error) {
      console.error("Error updating connection:", error);
    }
  };

  return {
    showOAuthModal,
    setShowOAuthModal,
    showIFlowCookieModal,
    setShowIFlowCookieModal,
    showAddApiKeyModal,
    setShowAddApiKeyModal,
    addConnectionError,
    setAddConnectionError,
    showBulkImportCodex,
    setShowBulkImportCodex,
    showEditModal,
    setShowEditModal,
    showEditNodeModal,
    setShowEditNodeModal,
    selectedConnection,
    setSelectedConnection,
    confirmState,
    setConfirmState,
    showAgRiskModal,
    setShowAgRiskModal,
    openOAuthConnection,
    triggerOAuthConnection,
    triggerApiKeyConnection,
    triggerAddConnection,
    handleAgRiskConfirm,
    handleUpdateNode,
    handleOAuthSuccess,
    handleIFlowCookieSuccess,
    handleSaveApiKey,
    handleUpdateConnection,
  };
}

export type UseConnectionModalsReturn = ReturnType<typeof useConnectionModals>;

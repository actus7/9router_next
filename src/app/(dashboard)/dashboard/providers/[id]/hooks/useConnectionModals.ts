"use client";

import { useState } from "react";
import { useNotificationStore } from "@/store/notificationStore";
import { saveApiKey, updateConnection, updateNode } from "./connectionModalActions";
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
  providerId, initialConnections, initialProvider, isCompatible, fetchConnections,
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

  const openOAuthConnection = () => setShowOAuthModal(true);

  const triggerOAuthConnection = (isOAuth: boolean) => {
    if (providerId === "antigravity" && typeof window !== "undefined") {
      if (window.localStorage.getItem(AG_RISK_STORAGE_KEY) !== "true") { setShowAgRiskModal(true); return; }
    }
    if (isOAuth) { openOAuthConnection(); return; }
    setAddConnectionError(""); setShowAddApiKeyModal(true);
  };

  const triggerApiKeyConnection = () => { setAddConnectionError(""); setShowAddApiKeyModal(true); };
  const triggerAddConnection = (isOAuth: boolean) => { if (isOAuth) { triggerOAuthConnection(isOAuth); return; } triggerApiKeyConnection(); };

  const handleAgRiskConfirm = (isOAuth: boolean) => {
    if (typeof window !== "undefined") window.localStorage.setItem(AG_RISK_STORAGE_KEY, "true");
    setShowAgRiskModal(false);
    if (isOAuth) { openOAuthConnection(); return; }
    triggerApiKeyConnection();
  };

  const handleUpdateNode = (formData: Record<string, string>) => updateNode(providerId, formData, fetchConnections, setShowEditNodeModal);
  const handleOAuthSuccess = () => { fetchConnections(); setShowOAuthModal(false); };
  const handleIFlowCookieSuccess = () => { fetchConnections(); setShowIFlowCookieModal(false); };
  const handleSaveApiKey = (formData: Record<string, unknown>) => saveApiKey(providerId, formData, fetchConnections, setShowAddApiKeyModal, setAddConnectionError);
  const handleUpdateConnection = (formData: Record<string, unknown>) => updateConnection(selectedConnection, formData, fetchConnections, setShowEditModal);

  return {
    showOAuthModal, setShowOAuthModal,
    showIFlowCookieModal, setShowIFlowCookieModal,
    showAddApiKeyModal, setShowAddApiKeyModal,
    addConnectionError, setAddConnectionError,
    showBulkImportCodex, setShowBulkImportCodex,
    showEditModal, setShowEditModal,
    showEditNodeModal, setShowEditNodeModal,
    selectedConnection, setSelectedConnection,
    confirmState, setConfirmState,
    showAgRiskModal, setShowAgRiskModal,
    openOAuthConnection, triggerOAuthConnection,
    triggerApiKeyConnection, triggerAddConnection,
    handleAgRiskConfirm, handleUpdateNode,
    handleOAuthSuccess, handleIFlowCookieSuccess,
    handleSaveApiKey, handleUpdateConnection,
  };
}

export type UseConnectionModalsReturn = ReturnType<typeof useConnectionModals>;

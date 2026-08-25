"use client";

import { useState, useCallback } from "react";
import OAuthModal from "./OAuthModal";
import KiroAuthModal from "./KiroAuthModal";
import KiroSocialOAuthModal from "./KiroSocialOAuthModal";

interface ProviderInfo {
  name?: string;
}

interface KiroOAuthWrapperProps {
  isOpen: boolean;
  providerInfo?: ProviderInfo;
  onSuccess?: () => void;
  onClose: () => void;
}

/**
 * Kiro OAuth Wrapper
 * Orchestrates between method selection, device code flow, and social login flow
 */
export default function KiroOAuthWrapper({ isOpen, providerInfo, onSuccess, onClose }: KiroOAuthWrapperProps) {
  const [authMethod, setAuthMethod] = useState<string | null>(null);
  const [socialProvider, setSocialProvider] = useState<string | null>(null);
  const [idcConfig, setIdcConfig] = useState<{ startUrl: string; region: string } | null>(null);

  const handleMethodSelect = useCallback((method: string, config?: Record<string, unknown>) => {
    if (method === "builder-id") {
      // Use device code flow (AWS Builder ID)
      setAuthMethod("builder-id");
    } else if (method === "idc") {
      // Use device code flow with IDC config
      setAuthMethod("idc");
      setIdcConfig(config as { startUrl: string; region: string });
    } else if (method === "social") {
      // Use social login with manual callback
      setAuthMethod("social");
      setSocialProvider((config as { provider: string }).provider);
    } else if (method === "import" || method === "api-key") {
      // Import / API-key handled in KiroAuthModal, just close
      onSuccess?.();
    }
  }, [onSuccess]);

  const handleBack = () => {
    setAuthMethod(null);
    setSocialProvider(null);
    setIdcConfig(null);
  };

  const handleSocialSuccess = () => {
    setAuthMethod(null);
    setSocialProvider(null);
    onSuccess?.();
    onClose?.(); // Close modal after success
  };

  const handleDeviceSuccess = () => {
    setAuthMethod(null);
    setIdcConfig(null);
    onSuccess?.();
    onClose?.(); // Close modal after success
  };

  // Show method selection first
  if (!authMethod) {
    return (
      <KiroAuthModal
        isOpen={isOpen}
        onMethodSelect={handleMethodSelect}
        onClose={onClose}
      />
    );
  }

  // Show device code flow (Builder ID or IDC)
  if (authMethod === "builder-id" || authMethod === "idc") {
    return (
      <OAuthModal
        isOpen={isOpen}
        provider="kiro"
        providerInfo={providerInfo}
        onSuccess={handleDeviceSuccess}
        onClose={handleBack}
        idcConfig={idcConfig || undefined}
      />
    );
  }

  // Show social login flow (Google/GitHub with manual callback)
  if (authMethod === "social" && socialProvider) {
    return (
      <KiroSocialOAuthModal
        isOpen={isOpen}
        provider={socialProvider as "google" | "github"}
        onSuccess={handleSocialSuccess}
        onClose={handleBack}
      />
    );
  }

  return null;
}

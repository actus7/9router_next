"use client";

import { useState, useEffect } from "react";
import { autoDetectKiroToken, importKiroToken, importKiroCliProxyJson, importKiroApiKey, type IdcCredentials } from "./kiroAuthHelpers";

export type { IdcCredentials };

export interface UseKiroAuthFlowProps {
  isOpen: boolean;
  onMethodSelect: (method: string, config?: Record<string, unknown>) => void;
}

/**
 * Encapsulates all Kiro auth state, effects, and action handlers.
 * Extracted verbatim from KiroAuthModal.tsx.
 */
export function useKiroAuthFlow({ isOpen, onMethodSelect }: UseKiroAuthFlowProps) {
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [idcStartUrl, setIdcStartUrl] = useState<string>("");
  const [idcRegion, setIdcRegion] = useState<string>("us-east-1");
  const [refreshToken, setRefreshToken] = useState<string>("");
  const [cliProxyJson, setCliProxyJson] = useState<string>("");
  const [apiKey, setApiKey] = useState<string>("");
  const [apiKeyRegion, setApiKeyRegion] = useState<string>("us-east-1");
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<boolean>(false);
  const [autoDetecting, setAutoDetecting] = useState<boolean>(false);
  const [autoDetected, setAutoDetected] = useState<boolean>(false);
  const [idcCredentials, setIdcCredentials] = useState<IdcCredentials | null>(null);

  // Auto-detect token when import method is selected
  useEffect(() => {
    if (selectedMethod !== "import" || !isOpen) return;

    const autoDetect = async () => {
      setAutoDetecting(true);
      setError(null);
      setAutoDetected(false);
      setIdcCredentials(null);
      try {
        const data = await autoDetectKiroToken();
        if (data.found) {
          setRefreshToken(data.refreshToken!);
          setAutoDetected(true);
          if (data.clientId && data.clientSecret) {
            setIdcCredentials({
              clientId: data.clientId, clientSecret: data.clientSecret,
              region: data.region!, authMethod: data.authMethod!, profileArn: data.profileArn!,
            });
          }
        } else {
          setError(data.error || "Could not auto-detect token");
        }
      } catch {
        setError("Failed to auto-detect token");
      } finally {
        setAutoDetecting(false);
      }
    };

    autoDetect();
  }, [selectedMethod, isOpen]);

  const handleMethodSelect = (method: string) => {
    setSelectedMethod(method);
    setError(null);
  };

  const handleBack = () => {
    setSelectedMethod(null);
    setError(null);
  };

  const handleImportToken = async () => {
    if (!refreshToken.trim()) { setError("Please enter a refresh token"); return; }
    setImporting(true); setError(null);
    try {
      await importKiroToken(refreshToken, idcCredentials);
      onMethodSelect("import");
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err));
    } finally { setImporting(false); }
  };

  const handleImportCliProxyJson = async () => {
    if (!cliProxyJson.trim()) { setError("Please paste CLIProxyAPI auth JSON"); return; }
    setImporting(true); setError(null);
    try {
      await importKiroCliProxyJson(cliProxyJson);
      onMethodSelect("import-cli-proxy");
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err));
    } finally { setImporting(false); }
  };

  const handleIdcContinue = () => {
    if (!idcStartUrl.trim()) {
      setError("Please enter your IDC start URL");
      return;
    }
    onMethodSelect("idc", { startUrl: idcStartUrl.trim(), region: idcRegion });
  };

  const handleApiKeyImport = async () => {
    if (!apiKey.trim()) { setError("Please enter an API key"); return; }
    setImporting(true); setError(null);
    try {
      await importKiroApiKey(apiKey, apiKeyRegion);
      onMethodSelect("api-key");
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err));
    } finally { setImporting(false); }
  };

  const handleSocialLogin = (provider: string) => {
    onMethodSelect("social", { provider });
  };

  return {
    selectedMethod,
    idcStartUrl,
    setIdcStartUrl,
    idcRegion,
    setIdcRegion,
    refreshToken,
    setRefreshToken,
    cliProxyJson,
    setCliProxyJson,
    apiKey,
    setApiKey,
    apiKeyRegion,
    setApiKeyRegion,
    error,
    importing,
    autoDetecting,
    autoDetected,
    handleMethodSelect,
    handleBack,
    handleImportToken,
    handleImportCliProxyJson,
    handleIdcContinue,
    handleApiKeyImport,
    handleSocialLogin,
  };
}

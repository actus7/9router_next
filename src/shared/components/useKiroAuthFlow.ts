"use client";

import { useState, useEffect } from "react";
import { autoDetectKiroToken, importKiroToken, importKiroCliProxyJson, importKiroApiKey, type IdcCredentials } from "./kiroAuthHelpers";

export type { IdcCredentials };

export interface UseKiroAuthFlowProps { isOpen: boolean; onMethodSelect: (method: string, config?: Record<string, unknown>) => void; }

export function useKiroAuthFlow({ isOpen, onMethodSelect }: UseKiroAuthFlowProps) {
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [idcStartUrl, setIdcStartUrl] = useState("");
  const [idcRegion, setIdcRegion] = useState("us-east-1");
  const [refreshToken, setRefreshToken] = useState("");
  const [cliProxyJson, setCliProxyJson] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyRegion, setApiKeyRegion] = useState("us-east-1");
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);
  const [idcCredentials, setIdcCredentials] = useState<IdcCredentials | null>(null);

  useEffect(() => {
    if (selectedMethod !== "import" || !isOpen) return;
    const run = async () => {
      setAutoDetecting(true); setError(null); setAutoDetected(false); setIdcCredentials(null);
      try {
        const data = await autoDetectKiroToken();
        if (data.found) {
          setRefreshToken(data.refreshToken!); setAutoDetected(true);
          if (data.clientId && data.clientSecret) setIdcCredentials({ clientId: data.clientId, clientSecret: data.clientSecret, region: data.region!, authMethod: data.authMethod!, profileArn: data.profileArn! });
        } else { setError(data.error || "Could not auto-detect token"); }
      } catch { setError("Failed to auto-detect token");
      } finally { setAutoDetecting(false); }
    };
    run();
  }, [selectedMethod, isOpen]);

  const handleMethodSelect = (m: string) => { setSelectedMethod(m); setError(null); };
  const handleBack = () => { setSelectedMethod(null); setError(null); };

  const handleImportToken = async () => {
    if (!refreshToken.trim()) { setError("Please enter a refresh token"); return; }
    setImporting(true); setError(null);
    try { await importKiroToken(refreshToken, idcCredentials); onMethodSelect("import");
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e));
    } finally { setImporting(false); }
  };

  const handleImportCliProxyJson = async () => {
    if (!cliProxyJson.trim()) { setError("Please paste CLIProxyAPI auth JSON"); return; }
    setImporting(true); setError(null);
    try { await importKiroCliProxyJson(cliProxyJson); onMethodSelect("import-cli-proxy");
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e));
    } finally { setImporting(false); }
  };

  const handleIdcContinue = () => { if (!idcStartUrl.trim()) { setError("Please enter your IDC start URL"); return; } onMethodSelect("idc", { startUrl: idcStartUrl.trim(), region: idcRegion }); };

  const handleApiKeyImport = async () => {
    if (!apiKey.trim()) { setError("Please enter an API key"); return; }
    setImporting(true); setError(null);
    try { await importKiroApiKey(apiKey, apiKeyRegion); onMethodSelect("api-key");
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e));
    } finally { setImporting(false); }
  };

  const handleSocialLogin = (p: string) => { onMethodSelect("social", { provider: p }); };

  return {
    selectedMethod, idcStartUrl, setIdcStartUrl, idcRegion, setIdcRegion,
    refreshToken, setRefreshToken, cliProxyJson, setCliProxyJson,
    apiKey, setApiKey, apiKeyRegion, setApiKeyRegion,
    error, importing, autoDetecting, autoDetected,
    handleMethodSelect, handleBack, handleImportToken, handleImportCliProxyJson,
    handleIdcContinue, handleApiKeyImport, handleSocialLogin,
  };
}

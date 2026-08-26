"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button, Input } from "@/shared/components";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

interface IdcCredentials {
  clientId: string;
  clientSecret: string;
  region: string;
  authMethod: string;
  profileArn: string;
}

interface KiroAuthModalProps {
  isOpen: boolean;
  onMethodSelect: (method: string, config?: Record<string, unknown>) => void;
  onClose: () => void;
}

/**
 * Kiro Auth Method Selection Modal
 * Auto-detects token from AWS SSO cache or allows manual import
 */
export default function KiroAuthModal({ isOpen, onMethodSelect, onClose }: KiroAuthModalProps) {
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
        const res = await fetch("/api/oauth/kiro/auto-import");
        const data = await res.json();

        if (data.found) {
          setRefreshToken(data.refreshToken);
          setAutoDetected(true);
          // Store IDC/organization credentials if present
          if (data.clientId && data.clientSecret) {
            setIdcCredentials({
              clientId: data.clientId,
              clientSecret: data.clientSecret,
              region: data.region,
              authMethod: data.authMethod,
              profileArn: data.profileArn,
            });
          }
        } else {
          setError(data.error || "Could not auto-detect token");
        }
      } catch (err) {
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
    if (!refreshToken.trim()) {
      setError("Please enter a refresh token");
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/kiro/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refreshToken: refreshToken.trim(),
          ...(idcCredentials || {}),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }

      // Success - notify parent to refresh connections
      onMethodSelect("import");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const handleImportCliProxyJson = async () => {
    if (!cliProxyJson.trim()) {
      setError("Please paste CLIProxyAPI auth JSON");
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/kiro/import-cli-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: cliProxyJson.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "CLIProxyAPI import failed");
      }

      onMethodSelect("import-cli-proxy");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const handleIdcContinue = () => {
    if (!idcStartUrl.trim()) {
      setError("Please enter your IDC start URL");
      return;
    }
    onMethodSelect("idc", { startUrl: idcStartUrl.trim(), region: idcRegion });
  };

  const handleApiKeyImport = async () => {
    if (!apiKey.trim()) {
      setError("Please enter an API key");
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/kiro/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          region: apiKeyRegion.trim() || "us-east-1",
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }

      // Success - notify parent to refresh connections
      onMethodSelect("api-key");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const handleSocialLogin = (provider: string) => {
    onMethodSelect("social", { provider });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "bg-surface border border-border-subtle rounded-[14px]",
          "shadow-[var(--shadow-elev)] ring-0 gap-0 p-0",
          "max-w-lg"
        )}
      >
        <div className="flex items-center justify-between p-2 border-b border-border-subtle">
          <DialogTitle className="text-lg font-semibold text-text-main ml-2">
            Connect Kiro
          </DialogTitle>
          <Button onClick={onClose} aria-label="Close" variant="ghost" size="sm" className="p-1.5">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </Button>
        </div>
        <div className="p-6 max-h-[calc(85vh-100px)] overflow-y-auto custom-scrollbar">
          <div className="flex flex-col gap-4">
        {/* Method Selection */}
        {!selectedMethod && (
          <div className="space-y-3">
            <p className="text-sm text-text-muted mb-4">
              Choose your authentication method:
            </p>

            {/* AWS Builder ID */}
            <Button
              onClick={() => onMethodSelect("builder-id")}
              variant="outline"
              className="w-full p-4 text-left rounded-lg hover:bg-sidebar transition-colors h-auto justify-start"
            >
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-primary mt-0.5">shield</span>
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">AWS Builder ID</h3>
                  <p className="text-sm text-text-muted">
                    Recommended for most users. Free AWS account required.
                  </p>
                </div>
              </div>
            </Button>

            {/* AWS IAM Identity Center (IDC) */}
            <Button
              onClick={() => handleMethodSelect("idc")}
              variant="outline"
              className="w-full p-4 text-left rounded-lg hover:bg-sidebar transition-colors h-auto justify-start"
            >
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-primary mt-0.5">business</span>
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">AWS IAM Identity Center</h3>
                  <p className="text-sm text-text-muted">
                    For enterprise users with custom AWS IAM Identity Center.
                  </p>
                </div>
              </div>
            </Button>

            {/* AWS API Key */}
            <Button
              onClick={() => handleMethodSelect("api-key")}
              variant="outline"
              className="w-full p-4 text-left rounded-lg hover:bg-sidebar transition-colors h-auto justify-start"
            >
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-primary mt-0.5">key</span>
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">API Key</h3>
                  <p className="text-sm text-text-muted">
                    Use a long-lived Kiro/CodeWhisperer API key (headless auth).
                  </p>
                </div>
              </div>
            </Button>

            {/* Google Social Login - HIDDEN */}
            <Button
              onClick={() => handleMethodSelect("social-google")}
              variant="outline"
              className="hidden w-full p-4 text-left rounded-lg hover:bg-sidebar transition-colors h-auto justify-start"
            >
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-primary mt-0.5">account_circle</span>
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">Google Account</h3>
                  <p className="text-sm text-text-muted">
                    Login with your Google account (manual callback).
                  </p>
                </div>
              </div>
            </Button>

            {/* GitHub Social Login - HIDDEN */}
            <Button
              onClick={() => handleMethodSelect("social-github")}
              variant="outline"
              className="hidden w-full p-4 text-left rounded-lg hover:bg-sidebar transition-colors h-auto justify-start"
            >
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-primary mt-0.5">code</span>
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">GitHub Account</h3>
                  <p className="text-sm text-text-muted">
                    Login with your GitHub account (manual callback).
                  </p>
                </div>
              </div>
            </Button>

            {/* Import Token */}
            <Button
              onClick={() => handleMethodSelect("import")}
              variant="outline"
              className="w-full p-4 text-left rounded-lg hover:bg-sidebar transition-colors h-auto justify-start"
            >
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-primary mt-0.5">file_upload</span>
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">Import Token</h3>
                  <p className="text-sm text-text-muted">
                    Paste refresh token from Kiro IDE.
                  </p>
                </div>
              </div>
            </Button>

            {/* Import CLIProxyAPI JSON */}
            <Button
              onClick={() => handleMethodSelect("import-cli-proxy")}
              variant="outline"
              className="w-full p-4 text-left rounded-lg hover:bg-sidebar transition-colors h-auto justify-start"
            >
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-primary mt-0.5">data_object</span>
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">Import CLIProxyAPI JSON</h3>
                  <p className="text-sm text-text-muted">
                    Paste external_idp auth JSON from CLIProxyAPI/Kiro Microsoft login.
                  </p>
                </div>
              </div>
            </Button>
          </div>
        )}

        {/* IDC Configuration */}
        {selectedMethod === "idc" && (
          <div className="space-y-4">
            <div>
              <Label className="block mb-2">
                IDC Start URL <span className="text-red-500">*</span>
              </Label>
              <Input
                value={idcStartUrl}
                onChange={(e) => setIdcStartUrl(e.target.value)}
                placeholder="https://your-org.awsapps.com/start"
                className="font-mono text-sm"
              />
              <p className="text-xs text-text-muted mt-1">
                Your organization&apos;s AWS IAM Identity Center URL
              </p>
            </div>

            <div>
              <Label className="block mb-2">
                AWS Region
              </Label>
              <Input
                value={idcRegion}
                onChange={(e) => setIdcRegion(e.target.value)}
                placeholder="us-east-1"
                className="font-mono text-sm"
              />
              <p className="text-xs text-text-muted mt-1">
                AWS region for your Identity Center (default: us-east-1)
              </p>
            </div>

            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}

            <div className="flex gap-2">
              <Button onClick={handleIdcContinue} fullWidth>
                Continue
              </Button>
              <Button onClick={handleBack} variant="ghost" fullWidth>
                Back
              </Button>
            </div>
          </div>
        )}

        {/* API Key */}
        {selectedMethod === "api-key" && (
          <div className="space-y-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex gap-2">
                <span className="material-symbols-outlined text-blue-600 dark:text-blue-400">info</span>
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  Paste a long-lived Kiro/CodeWhisperer API key. It is validated
                  against AWS and stored directly as a bearer credential (no refresh).
                </p>
              </div>
            </div>

            <div>
              <Label className="block mb-2">
                API Key <span className="text-red-500">*</span>
              </Label>
              <Input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Paste your Kiro API key..."
                className="font-mono text-sm"
              />
            </div>

            <div>
              <Label className="block mb-2">
                AWS Region
              </Label>
              <Input
                value={apiKeyRegion}
                onChange={(e) => setApiKeyRegion(e.target.value)}
                placeholder="us-east-1"
                className="font-mono text-sm"
              />
              <p className="text-xs text-text-muted mt-1">
                AWS region for the key (default: us-east-1)
              </p>
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={handleApiKeyImport} fullWidth disabled={importing || !apiKey.trim()}>
                {importing ? "Validating..." : "Add API Key"}
              </Button>
              <Button onClick={handleBack} variant="ghost" fullWidth>
                Back
              </Button>
            </div>
          </div>
        )}

        {/* Social Login Info (Google) */}
        {selectedMethod === "social-google" && (
          <div className="space-y-4">
            <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-lg border border-amber-200 dark:border-amber-800">
              <div className="flex gap-2">
                <span className="material-symbols-outlined text-amber-600 dark:text-amber-400">info</span>
                <div className="flex-1 text-sm">
                  <p className="font-medium text-amber-900 dark:text-amber-100 mb-1">
                    Manual Callback Required
                  </p>
                  <p className="text-amber-800 dark:text-amber-200">
                    After login, you&apos;ll need to copy the callback URL from your browser and paste it back here.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={() => handleSocialLogin("google")} fullWidth>
                Continue with Google
              </Button>
              <Button onClick={handleBack} variant="ghost" fullWidth>
                Back
              </Button>
            </div>
          </div>
        )}

        {/* Social Login Info (GitHub) */}
        {selectedMethod === "social-github" && (
          <div className="space-y-4">
            <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-lg border border-amber-200 dark:border-amber-800">
              <div className="flex gap-2">
                <span className="material-symbols-outlined text-amber-600 dark:text-amber-400">info</span>
                <div className="flex-1 text-sm">
                  <p className="font-medium text-amber-900 dark:text-amber-100 mb-1">
                    Manual Callback Required
                  </p>
                  <p className="text-amber-800 dark:text-amber-200">
                    After login, you&apos;ll need to copy the callback URL from your browser and paste it back here.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={() => handleSocialLogin("github")} fullWidth>
                Continue with GitHub
              </Button>
              <Button onClick={handleBack} variant="ghost" fullWidth>
                Back
              </Button>
            </div>
          </div>
        )}

        {/* Import Token */}
        {selectedMethod === "import" && (
          <div className="space-y-4">
            {/* Auto-detecting state */}
            {autoDetecting && (
              <div className="text-center py-6">
                <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="material-symbols-outlined text-3xl text-primary animate-spin">
                    progress_activity
                  </span>
                </div>
                <h3 className="text-lg font-semibold mb-2">Auto-detecting token...</h3>
                <p className="text-sm text-text-muted">
                  Reading from AWS SSO cache
                </p>
              </div>
            )}

            {/* Form (shown after auto-detect completes) */}
            {!autoDetecting && (
              <>
                {/* Success message if auto-detected */}
                {autoDetected && (
                  <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg border border-green-200 dark:border-green-800">
                    <div className="flex gap-2">
                      <span className="material-symbols-outlined text-green-600 dark:text-green-400">check_circle</span>
                      <p className="text-sm text-green-800 dark:text-green-200">
                        Token auto-detected from Kiro IDE successfully!
                      </p>
                    </div>
                  </div>
                )}

                {/* Info message if not auto-detected */}
                {!autoDetected && !error && (
                  <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
                    <div className="flex gap-2">
                      <span className="material-symbols-outlined text-blue-600 dark:text-blue-400">info</span>
                      <p className="text-sm text-blue-800 dark:text-blue-200">
                        Kiro IDE not detected. Please paste your refresh token manually.
                      </p>
                    </div>
                  </div>
                )}

                <div>
                  <Label className="block mb-2">
                    Refresh Token <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    value={refreshToken}
                    onChange={(e) => setRefreshToken(e.target.value)}
                    placeholder="Token will be auto-filled..."
                    className="font-mono text-sm"
                  />
                </div>

                {error && (
                  <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
                    <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button onClick={handleImportToken} fullWidth disabled={importing || !refreshToken.trim()}>
                    {importing ? "Importing..." : "Import Token"}
                  </Button>
                  <Button onClick={handleBack} variant="ghost" fullWidth>
                    Back
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Import CLIProxyAPI JSON */}
        {selectedMethod === "import-cli-proxy" && (
          <div className="space-y-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex gap-2">
                <span className="material-symbols-outlined text-blue-600 dark:text-blue-400">info</span>
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  Paste the Kiro CLIProxyAPI auth JSON containing auth_method=external_idp. Only Microsoft login token endpoints are accepted.
                </p>
              </div>
            </div>

            <div>
              <Label className="block mb-2">
                CLIProxyAPI Auth JSON <span className="text-red-500">*</span>
              </Label>
              <Textarea
                value={cliProxyJson}
                onChange={(e) => setCliProxyJson(e.target.value)}
                placeholder={'{"auth_method":"external_idp","access_token":"...","refresh_token":"...","client_id":"...","token_endpoint":"https://login.microsoftonline.com/.../oauth2/v2.0/token","profile_arn":"...","scopes":"..."}'}
                className="min-h-40 font-mono"
              />
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={handleImportCliProxyJson} fullWidth disabled={importing || !cliProxyJson.trim()}>
                {importing ? "Importing..." : "Import CLIProxyAPI JSON"}
              </Button>
              <Button onClick={handleBack} variant="ghost" fullWidth>
                Back
              </Button>
            </div>
          </div>
        )}
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

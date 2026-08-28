"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button, Input, OAuthModal } from "@/shared/components";
import { cn } from "@/lib/utils";
import { Key, Unlock, X } from "lucide-react";
import { translate } from "@/i18n/runtime";

const GITLAB_COM = "https://gitlab.com";

function getRedirectUri(): string {
  if (typeof window === "undefined") return "http://localhost/callback";
  const port = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
  return `http://localhost:${port}/callback`;
}

interface ProviderInfo {
  name?: string;
}

interface GitLabAuthModalProps {
  isOpen: boolean;
  providerInfo?: ProviderInfo;
  onSuccess?: () => void;
  onClose: () => void;
}

/**
 * GitLab Duo Authentication Modal
 * Supports two modes:
 * - OAuth (PKCE): requires OAuth App Client ID (and optional Client Secret)
 * - PAT: requires Personal Access Token
 */
export default function GitLabAuthModal({ isOpen, providerInfo, onSuccess, onClose }: GitLabAuthModalProps) {
  const [mode, setMode] = useState<"oauth" | "pat" | null>(null);
  const [baseUrl, setBaseUrl] = useState<string>(GITLAB_COM);
  const [clientId, setClientId] = useState<string>("");
  const [clientSecret, setClientSecret] = useState<string>("");
  const [pat, setPat] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [showOAuth, setShowOAuth] = useState<boolean>(false);
  const [oauthMeta, setOauthMeta] = useState<{ baseUrl: string; clientId: string; clientSecret: string } | null>(null);

  const reset = () => {
    setMode(null);
    setBaseUrl(GITLAB_COM);
    setClientId("");
    setClientSecret("");
    setPat("");
    setError(null);
    setLoading(false);
    setShowOAuth(false);
    setOauthMeta(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleOAuthStart = () => {
    if (!clientId.trim()) {
      setError("Client ID is required");
      return;
    }
    setError(null);
    setOauthMeta({ baseUrl: baseUrl.trim() || GITLAB_COM, clientId: clientId.trim(), clientSecret: clientSecret.trim() });
    setShowOAuth(true);
  };

  const handlePATSubmit = async () => {
    if (!pat.trim()) {
      setError("Personal Access Token is required");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/oauth/gitlab/pat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: pat.trim(), baseUrl: baseUrl.trim() || GITLAB_COM }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Authentication failed");
      onSuccess?.();
      handleClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  // Sub-modal for OAuth PKCE flow
  if (showOAuth && oauthMeta) {
    return (
      <OAuthModal
        isOpen
        provider="gitlab"
        providerInfo={providerInfo}
        oauthMeta={oauthMeta}
        onSuccess={() => { onSuccess?.(); handleClose(); }}
        onClose={() => { setShowOAuth(false); setOauthMeta(null); }}
      />
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
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
            {translate("Connect GitLab Duo")}
          </DialogTitle>
          <Button onClick={handleClose} aria-label={translate("Close") ?? "Close"} variant="ghost" size="sm" className="p-1.5">
            <X className="size-5" />
          </Button>
        </div>
        <div className="p-6 max-h-[calc(85vh-100px)] overflow-y-auto custom-scrollbar">
          <div className="flex flex-col gap-4">
        {/* Mode selection */}
        {!mode && (
          <>
            <p className="text-sm text-text-muted">
              {translate("Choose how to authenticate with GitLab Duo:")}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Button
                onClick={() => setMode("oauth")}
                variant="outline"
                className="flex flex-col items-center gap-2 p-4 rounded-lg hover:border-primary hover:bg-primary/5 transition-colors text-left h-auto"
              >
                <Unlock className="size-4" />
                <div>
                  <p className="text-sm font-medium">{translate("OAuth App")}</p>
                  <p className="text-xs text-text-muted">{translate("Use a GitLab OAuth application")}</p>
                </div>
              </Button>
              <Button
                onClick={() => setMode("pat")}
                variant="outline"
                className="flex flex-col items-center gap-2 p-4 rounded-lg hover:border-primary hover:bg-primary/5 transition-colors text-left h-auto"
              >
                <Key className="size-4" />
                <div>
                  <p className="text-sm font-medium">{translate("Personal Access Token")}</p>
                  <p className="text-xs text-text-muted">{translate("Use a GitLab PAT with api scope")}</p>
                </div>
              </Button>
            </div>
          </>
        )}

        {/* OAuth mode */}
        {mode === "oauth" && (
          <>
            <p className="text-xs text-text-muted">
              {translate("Create an OAuth application at")}{" "}
              <a href={`${baseUrl.trim() || GITLAB_COM}/-/profile/applications`} target="_blank" rel="noreferrer" className="text-primary underline">
                GitLab Applications
              </a>{" "}
              {translate("with redirect URI")}{" "}
              <code className="bg-sidebar px-1 rounded text-xs">{getRedirectUri()}</code>
            </p>
            <Input label={translate("GitLab Base URL") ?? "GitLab Base URL"} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={GITLAB_COM} />
            <Input label={translate("Client ID") ?? "Client ID"} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder={translate("Your OAuth application client ID") ?? "Your OAuth application client ID"} />
            <Input label={translate("Client Secret (optional for PKCE)") ?? "Client Secret (optional for PKCE)"} value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={translate("Leave empty for public PKCE app") ?? "Leave empty for public PKCE app"} />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex gap-2">
              <Button onClick={handleOAuthStart} fullWidth disabled={!clientId.trim()}>
                {translate("Authorize")}
              </Button>
              <Button onClick={() => { setMode(null); setError(null); }} variant="ghost" fullWidth>
                {translate("Back")}
              </Button>
            </div>
          </>
        )}

        {/* PAT mode */}
        {mode === "pat" && (
          <>
            <p className="text-xs text-text-muted">
              {translate("Create a PAT at")}{" "}
              <a href={`${baseUrl.trim() || GITLAB_COM}/-/user_settings/personal_access_tokens`} target="_blank" rel="noreferrer" className="text-primary underline">
                GitLab Access Tokens
              </a>{" "}
              {translate("with scopes")}{" "}<code className="bg-sidebar px-1 rounded text-xs">api</code>,{" "}
              <code className="bg-sidebar px-1 rounded text-xs">read_user</code>, and{" "}
              <code className="bg-sidebar px-1 rounded text-xs">ai_features</code>.
            </p>
            <Input label={translate("GitLab Base URL") ?? "GitLab Base URL"} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={GITLAB_COM} />
            <Input label={translate("Personal Access Token") ?? "Personal Access Token"} value={pat} onChange={(e) => setPat(e.target.value)} placeholder="glpat-xxxxxxxxxxxxxxxxxxxx" type="password" />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex gap-2">
              <Button onClick={handlePATSubmit} fullWidth disabled={!pat.trim() || loading} loading={loading}>
                {translate("Connect")}
              </Button>
              <Button onClick={() => { setMode(null); setError(null); }} variant="ghost" fullWidth>
                {translate("Back")}
              </Button>
            </div>
          </>
        )}
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

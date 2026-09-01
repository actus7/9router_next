"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import OAuthModal from "@/shared/components/OAuthModal";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { GITLAB_COM, submitGitLabPAT } from "./gitlabAuthHelpers";
import { GitLabModeSelection, GitLabOAuthForm, GitLabPATForm } from "./GitLabAuthSections";

interface GitLabAuthModalProps {
  isOpen: boolean; providerInfo?: { name?: string }; onSuccess?: () => void; onClose: () => void;
}

export default function GitLabAuthModal({ isOpen, providerInfo, onSuccess, onClose }: GitLabAuthModalProps) {
  const [mode, setMode] = useState<"oauth" | "pat" | null>(null);
  const [baseUrl, setBaseUrl] = useState(GITLAB_COM);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [pat, setPat] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOAuth, setShowOAuth] = useState(false);
  const [oauthMeta, setOauthMeta] = useState<{ baseUrl: string; clientId: string; clientSecret: string } | null>(null);

  const reset = () => { setMode(null); setBaseUrl(GITLAB_COM); setClientId(""); setClientSecret(""); setPat(""); setError(null); setLoading(false); setShowOAuth(false); setOauthMeta(null); };
  const handleClose = () => { reset(); onClose(); };
  const handleOAuthStart = () => { if (!clientId.trim()) { setError("Client ID is required"); return; } setError(null); setOauthMeta({ baseUrl: baseUrl.trim() || GITLAB_COM, clientId: clientId.trim(), clientSecret: clientSecret.trim() }); setShowOAuth(true); };
  const handlePATSubmit = () => submitGitLabPAT(pat, baseUrl, onSuccess, handleClose, setError, setLoading);

  if (!isOpen) return null;
  if (showOAuth && oauthMeta) return <OAuthModal isOpen provider="gitlab" providerInfo={providerInfo} oauthMeta={oauthMeta} onSuccess={() => { onSuccess?.(); handleClose(); }} onClose={() => { setShowOAuth(false); setOauthMeta(null); }} />;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent showCloseButton={false} className={cn("bg-surface border border-border-subtle rounded-[14px]", "shadow-[var(--shadow-elev)] ring-0 gap-0 p-0", "max-w-lg")}>
        <div className="flex items-center justify-between p-2 border-b border-border-subtle">
          <DialogTitle className="text-lg font-semibold text-text-main ml-2">{translate("Connect GitLab Duo")}</DialogTitle>
          <Button onClick={handleClose} aria-label={translate("Close") ?? "Close"} variant="ghost" size="sm" className="p-1.5"><X className="size-5" /></Button>
        </div>
        <div className="p-6 max-h-[calc(85vh-100px)] overflow-y-auto custom-scrollbar">
          <div className="flex flex-col gap-4">
            {!mode && <GitLabModeSelection onSelect={setMode} />}
            {mode === "oauth" && <GitLabOAuthForm baseUrl={baseUrl} setBaseUrl={setBaseUrl} clientId={clientId} setClientId={setClientId} clientSecret={clientSecret} setClientSecret={setClientSecret} error={error} onStart={handleOAuthStart} onBack={() => { setMode(null); setError(null); }} />}
            {mode === "pat" && <GitLabPATForm baseUrl={baseUrl} setBaseUrl={setBaseUrl} pat={pat} setPat={setPat} error={error} loading={loading} onSubmit={handlePATSubmit} onBack={() => { setMode(null); setError(null); }} />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

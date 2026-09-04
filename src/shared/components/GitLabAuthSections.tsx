"use client";

import { Button } from "@/components/ui/button";
import { FormInput as Input } from "@/shared/components/FormInput";
import { Key, Unlock } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { GITLAB_COM, getRedirectUri } from "./gitlabAuthHelpers";

export function GitLabModeSelection({ onSelect }: { onSelect: (mode: "oauth" | "pat") => void }) {
  return (
    <>
      <p className="text-sm text-text-muted">{translate("Choose how to authenticate with GitLab Duo:")}</p>
      <div className="grid grid-cols-2 gap-3">
        <Button onClick={() => onSelect("oauth")} variant="outline" className="flex flex-col items-center gap-2 p-4 rounded-lg hover:border-primary hover:bg-primary/5 transition-colors text-left h-auto">
          <Unlock className="size-4" />
          <div><p className="text-sm font-medium">{translate("OAuth App")}</p><p className="text-xs text-text-muted">{translate("Use a GitLab OAuth application")}</p></div>
        </Button>
        <Button onClick={() => onSelect("pat")} variant="outline" className="flex flex-col items-center gap-2 p-4 rounded-lg hover:border-primary hover:bg-primary/5 transition-colors text-left h-auto">
          <Key className="size-4" />
          <div><p className="text-sm font-medium">{translate("Personal Access Token")}</p><p className="text-xs text-text-muted">{translate("Use a GitLab PAT with api scope")}</p></div>
        </Button>
      </div>
    </>
  );
}

interface GitLabOAuthFormProps {
  baseUrl: string; setBaseUrl: (v: string) => void;
  clientId: string; setClientId: (v: string) => void;
  clientSecret: string; setClientSecret: (v: string) => void;
  error: string | null; onStart: () => void; onBack: () => void;
}

export function GitLabOAuthForm({ baseUrl, setBaseUrl, clientId, setClientId, clientSecret, setClientSecret, error, onStart, onBack }: GitLabOAuthFormProps) {
  return (
    <>
      <p className="text-xs text-text-muted">
        {translate("Create an OAuth application at")}{" "}
        <a href={`${baseUrl.trim() || GITLAB_COM}/-/profile/applications`} target="_blank" rel="noreferrer" className="text-primary underline">GitLab Applications</a>{" "}
        {translate("with redirect URI")}{" "}<code className="bg-sidebar px-1 rounded text-xs">{getRedirectUri()}</code>
      </p>
      <Input label={translate("GitLab Base URL") ?? "GitLab Base URL"} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={GITLAB_COM} />
      <Input label={translate("Client ID") ?? "Client ID"} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder={translate("Your OAuth application client ID") ?? "Your OAuth application client ID"} />
      <Input label={translate("Client Secret (optional for PKCE)") ?? "Client Secret (optional for PKCE)"} value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={translate("Leave empty for public PKCE app") ?? "Leave empty for public PKCE app"} />
      {error && <p className="text-sm text-destructive-foreground">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={onStart} fullWidth disabled={!clientId.trim()}>{translate("Authorize")}</Button>
        <Button onClick={onBack} variant="ghost" fullWidth>{translate("Back")}</Button>
      </div>
    </>
  );
}

interface GitLabPATFormProps {
  baseUrl: string; setBaseUrl: (v: string) => void;
  pat: string; setPat: (v: string) => void;
  error: string | null; loading: boolean; onSubmit: () => void; onBack: () => void;
}

export function GitLabPATForm({ baseUrl, setBaseUrl, pat, setPat, error, loading, onSubmit, onBack }: GitLabPATFormProps) {
  return (
    <>
      <p className="text-xs text-text-muted">
        {translate("Create a PAT at")}{" "}
        <a href={`${baseUrl.trim() || GITLAB_COM}/-/user_settings/personal_access_tokens`} target="_blank" rel="noreferrer" className="text-primary underline">GitLab Access Tokens</a>{" "}
        {translate("with scopes")}{" "}<code className="bg-sidebar px-1 rounded text-xs">api</code>,{" "}
        <code className="bg-sidebar px-1 rounded text-xs">read_user</code>, and{" "}
        <code className="bg-sidebar px-1 rounded text-xs">ai_features</code>.
      </p>
      <Input label={translate("GitLab Base URL") ?? "GitLab Base URL"} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={GITLAB_COM} />
      <Input label={translate("Personal Access Token") ?? "Personal Access Token"} value={pat} onChange={(e) => setPat(e.target.value)} placeholder="glpat-xxxxxxxxxxxxxxxxxxxx" type="password" />
      {error && <p className="text-sm text-destructive-foreground">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={onSubmit} fullWidth disabled={!pat.trim() || loading} loading={loading}>{translate("Connect")}</Button>
        <Button onClick={onBack} variant="ghost" fullWidth>{translate("Back")}</Button>
      </div>
    </>
  );
}

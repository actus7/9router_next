"use client";

import { Button } from "@/components/ui/button";
import { FormInput as Input } from "@/components/ui/form-input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Braces, Building, CheckCircle2, CircleUser, Code, Info, Key, Loader2, Shield, Upload } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { MethodCard } from "./MethodCard";

/* ------------------------------------------------------------------ */
/*  Method Selection Section                                           */
/* ------------------------------------------------------------------ */

interface MethodSelectionSectionProps {
  onBuilderIdClick: () => void;
  onMethodClick: (method: string) => void;
}

export function MethodSelectionSection({ onBuilderIdClick, onMethodClick }: MethodSelectionSectionProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted mb-4">{translate("Choose your authentication method:")}</p>
      <MethodCard icon={<Shield className="size-4" />} title="AWS Builder ID" description="Recommended for most users. Free AWS account required." onClick={onBuilderIdClick} />
      <MethodCard icon={<Building className="size-4" />} title="AWS IAM Identity Center" description="For enterprise users with custom AWS IAM Identity Center." onClick={() => onMethodClick("idc")} />
      <MethodCard icon={<Key className="size-4" />} title="API Key" description="Use a long-lived Kiro/CodeWhisperer API key (headless authentication)." onClick={() => onMethodClick("api-key")} />
      <MethodCard icon={<CircleUser className="size-4" />} title="Google Account" description="Login with your Google account (manual callback)." onClick={() => onMethodClick("social-google")} hidden />
      <MethodCard icon={<Code className="size-4" />} title="GitHub Account" description="Login with your GitHub account (manual callback)." onClick={() => onMethodClick("social-github")} hidden />
      <MethodCard icon={<Upload className="size-4" />} title="Import Token" description="Paste refresh token from Kiro IDE." onClick={() => onMethodClick("import")} />
      <MethodCard icon={<Braces className="size-4" />} title="Import CLIProxyAPI JSON" description="Paste the external_idp auth JSON from Microsoft CLIProxyAPI/Kiro login." onClick={() => onMethodClick("import-cli-proxy")} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  IDC Configuration Section                                          */
/* ------------------------------------------------------------------ */

interface IdcConfigSectionProps {
  idcStartUrl: string;
  setIdcStartUrl: (v: string) => void;
  idcRegion: string;
  setIdcRegion: (v: string) => void;
  error: string | null;
  handleIdcContinue: () => void;
  handleBack: () => void;
}

export function IdcConfigSection({
  idcStartUrl,
  setIdcStartUrl,
  idcRegion,
  setIdcRegion,
  error,
  handleIdcContinue,
  handleBack,
}: IdcConfigSectionProps) {
  return (
    <div className="space-y-4">
      <div>
        <Label className="block mb-2">
          {translate("IDC Start URL")} <span className="text-red-500">*</span>
        </Label>
        <Input
          value={idcStartUrl}
          onChange={(e) => setIdcStartUrl(e.target.value)}
          placeholder="https://your-org.awsapps.com/start"
          className="font-mono text-sm"
        />
        <p className="text-xs text-text-muted mt-1">
          {translate("Your organization's AWS IAM Identity Center URL")}
        </p>
      </div>

      <div>
        <Label className="block mb-2">
          {translate("AWS Region")}
        </Label>
        <Input
          value={idcRegion}
          onChange={(e) => setIdcRegion(e.target.value)}
          placeholder="us-east-1"
          className="font-mono text-sm"
        />
        <p className="text-xs text-text-muted mt-1">
          {translate("AWS region for your Identity Center (default: us-east-1)")}
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      <div className="flex gap-2">
        <Button onClick={handleIdcContinue} fullWidth>
          {translate("Continue")}
        </Button>
        <Button onClick={handleBack} variant="ghost" fullWidth>
          {translate("Back")}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  API Key Section                                                    */
/* ------------------------------------------------------------------ */

interface ApiKeySectionProps {
  apiKey: string;
  setApiKey: (v: string) => void;
  apiKeyRegion: string;
  setApiKeyRegion: (v: string) => void;
  error: string | null;
  importing: boolean;
  handleApiKeyImport: () => Promise<void>;
  handleBack: () => void;
}

export function ApiKeySection({
  apiKey,
  setApiKey,
  apiKeyRegion,
  setApiKeyRegion,
  error,
  importing,
  handleApiKeyImport,
  handleBack,
}: ApiKeySectionProps) {
  return (
    <div className="space-y-4">
      <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
        <div className="flex gap-2">
          <Info className="size-4" />
          <p className="text-sm text-blue-800 dark:text-blue-200">
            {translate("Paste a long-lived Kiro/CodeWhisperer API key. It is validated against AWS and stored directly as a bearer credential (no refresh).")}
          </p>
        </div>
      </div>

      <div>
        <Label className="block mb-2">
          {translate("API Key")} <span className="text-red-500">*</span>
        </Label>
        <Input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={translate("Paste your Kiro API key...") ?? "Paste your Kiro API key..."}
          className="font-mono text-sm"
        />
      </div>

      <div>
        <Label className="block mb-2">
          {translate("AWS Region")}
        </Label>
        <Input
          value={apiKeyRegion}
          onChange={(e) => setApiKeyRegion(e.target.value)}
          placeholder="us-east-1"
          className="font-mono text-sm"
        />
        <p className="text-xs text-text-muted mt-1">
          {translate("AWS region for the key (default: us-east-1)")}
        </p>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      <div className="flex gap-2">
        <Button onClick={handleApiKeyImport} fullWidth disabled={importing || !apiKey.trim()}>
          {importing ? (translate("Validating...") ?? "Validating...") : (translate("Add API Key") ?? "Add API Key")}
        </Button>
        <Button onClick={handleBack} variant="ghost" fullWidth>
          {translate("Back")}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Social Login Section (Google)                                      */
/* ------------------------------------------------------------------ */

interface SocialGoogleSectionProps {
  handleSocialLogin: (provider: string) => void;
  handleBack: () => void;
}

export function SocialGoogleSection({ handleSocialLogin, handleBack }: SocialGoogleSectionProps) {
  return (
    <div className="space-y-4">
      <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-lg border border-amber-200 dark:border-amber-800">
        <div className="flex gap-2">
          <Info className="size-4" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-amber-900 dark:text-amber-100 mb-1">
              {translate("Manual Callback Required")}
            </p>
            <p className="text-amber-800 dark:text-amber-200">
              {translate("After authorization, copy the full URL from your browser address bar.")}
            </p>
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={() => handleSocialLogin("google")} fullWidth>
          {translate("Continue with Google")}
        </Button>
        <Button onClick={handleBack} variant="ghost" fullWidth>
          {translate("Back")}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Social Login Section (GitHub)                                      */
/* ------------------------------------------------------------------ */

interface SocialGithubSectionProps {
  handleSocialLogin: (provider: string) => void;
  handleBack: () => void;
}

export function SocialGithubSection({ handleSocialLogin, handleBack }: SocialGithubSectionProps) {
  return (
    <div className="space-y-4">
      <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-lg border border-amber-200 dark:border-amber-800">
        <div className="flex gap-2">
          <Info className="size-4" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-amber-900 dark:text-amber-100 mb-1">
              {translate("Manual Callback Required")}
            </p>
            <p className="text-amber-800 dark:text-amber-200">
              {translate("After authorization, copy the full URL from your browser address bar.")}
            </p>
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={() => handleSocialLogin("github")} fullWidth>
          {translate("Continue with GitHub")}
        </Button>
        <Button onClick={handleBack} variant="ghost" fullWidth>
          {translate("Back")}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Import Token Section                                               */
/* ------------------------------------------------------------------ */

interface ImportTokenSectionProps {
  autoDetecting: boolean;
  autoDetected: boolean;
  error: string | null;
  refreshToken: string;
  setRefreshToken: (v: string) => void;
  importing: boolean;
  handleImportToken: () => Promise<void>;
  handleBack: () => void;
}

export function ImportTokenSection({
  autoDetecting,
  autoDetected,
  error,
  refreshToken,
  setRefreshToken,
  importing,
  handleImportToken,
  handleBack,
}: ImportTokenSectionProps) {
  return (
    <div className="space-y-4">
      {/* Auto-detecting state */}
      {autoDetecting && (
        <div className="text-center py-6">
          <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
            <Loader2 className="size-4" />
          </div>
          <h3 className="text-lg font-semibold mb-2">{translate("Auto-detecting token...")}</h3>
          <p className="text-sm text-text-muted">
            {translate("Reading from AWS SSO cache")}
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
                <CheckCircle2 className="size-4" />
                <p className="text-sm text-green-800 dark:text-green-200">
                  {translate("Token auto-detected from Kiro IDE successfully!")}
                </p>
              </div>
            </div>
          )}

          {/* Info message if not auto-detected */}
          {!autoDetected && !error && (
            <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex gap-2">
                <Info className="size-4" />
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  {translate("Kiro IDE not detected. Please paste your refresh token manually.")}
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
              placeholder={translate("The token will be auto-filled...") ?? "The token will be auto-filled..."}
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
              {importing ? (translate("Importing...") ?? "Importing...") : (translate("Import Token") ?? "Import Token")}
            </Button>
            <Button onClick={handleBack} variant="ghost" fullWidth>
              {translate("Back")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Import CLIProxyAPI JSON Section                                     */
/* ------------------------------------------------------------------ */

interface ImportCliProxySectionProps {
  cliProxyJson: string;
  setCliProxyJson: (v: string) => void;
  error: string | null;
  importing: boolean;
  handleImportCliProxyJson: () => Promise<void>;
  handleBack: () => void;
}

export function ImportCliProxySection({
  cliProxyJson,
  setCliProxyJson,
  error,
  importing,
  handleImportCliProxyJson,
  handleBack,
}: ImportCliProxySectionProps) {
  return (
    <div className="space-y-4">
      <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
        <div className="flex gap-2">
          <Info className="size-4" />
          <p className="text-sm text-blue-800 dark:text-blue-200">
            {translate("Paste the CLIProxyAPI auth JSON from Kiro containing auth_method=external_idp. Only Microsoft login token endpoints are accepted.")}
          </p>
        </div>
      </div>

      <div>
        <Label className="block mb-2">
          {translate("CLIProxyAPI Auth JSON")} <span className="text-red-500">*</span>
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
          {importing ? (translate("Importing...") ?? "Importing...") : (translate("Import CLIProxyAPI JSON") ?? "Import CLIProxyAPI JSON")}
        </Button>
        <Button onClick={handleBack} variant="ghost" fullWidth>
          {translate("Back")}
        </Button>
      </div>
    </div>
  );
}

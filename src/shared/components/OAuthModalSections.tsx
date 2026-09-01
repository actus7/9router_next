"use client";

import { Button } from "@/components/ui/button";
import { FormInput as Input } from "@/components/ui/form-input";
import { AlertCircle, Check, CheckCircle2, Copy, ExternalLink, Loader2 } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { PASTE_TOKEN_PROVIDERS, type ProviderInfo } from "./useOAuthFlow";

/* ------------------------------------------------------------------ */
/*  Shared prop fragments used by multiple section components          */
/* ------------------------------------------------------------------ */

interface CopyActions {
  copied: string | null;
  copy: (text: string, id: string) => void;
}

interface ManualSubmitActions {
  handleManualSubmit: () => Promise<void>;
  handleClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Proxy OAuth Section (Trae / Windsurf / Zed)                        */
/* ------------------------------------------------------------------ */

interface ProxyOAuthSectionProps extends CopyActions, ManualSubmitActions {
  provider: string;
  step: "waiting" | "input" | "success" | "error";
  authMode: "browser" | "paste-token";
  callbackUrl: string;
  pasteToken: string;
  ideStatus: { installed: boolean; path: string | null } | null;
  error: string | null;
  setAuthMode: (m: "browser" | "paste-token") => void;
  setError: (e: string | null) => void;
  setStep: (s: "waiting" | "input" | "success" | "error") => void;
  setCallbackUrl: (v: string) => void;
  setPasteToken: (v: string) => void;
  startOAuthFlow: () => Promise<void>;
}

export function ProxyOAuthSection({
  provider,
  step,
  authMode,
  callbackUrl,
  pasteToken,
  ideStatus,
  error: _error,
  setAuthMode,
  setError,
  setStep,
  setCallbackUrl,
  setPasteToken,
  startOAuthFlow,
  handleManualSubmit,
  handleClose,
  copied: _copied,
  copy: _copy,
}: ProxyOAuthSectionProps) {
  return (
    <>
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={() => { setAuthMode("browser"); setError(null); setStep("waiting"); startOAuthFlow(); }}
          variant={authMode === "browser" ? "primary" : "ghost"}
          className="flex-1"
        >
          🌐 {translate("Sign in with browser")}
        </Button>
        <Button
          type="button"
          onClick={() => { setAuthMode("paste-token"); setError(null); setStep("input"); }}
          variant={authMode === "paste-token" ? "primary" : "ghost"}
          className="flex-1"
        >
          🔑 {translate("Paste token")}
        </Button>
      </div>

      {authMode === "browser" && (
        <>
          {step === "waiting" && (
            <div className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg bg-sidebar/50">
              <Loader2 className="size-4" />
              <span className="text-sm">{translate("Waiting for browser authorization...")}</span>
            </div>
          )}
          {step === "input" && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text-muted">
                {translate("Popup was blocked. After authorizing in the browser, paste the complete callback URL here:")}
              </p>
              <Input
                value={callbackUrl}
                onChange={(e) => setCallbackUrl(e.target.value)}
                placeholder="http://127.0.0.1:.../callback?..."
                className="font-mono text-xs"
              />
              <div className="flex gap-2">
                <Button onClick={handleManualSubmit} fullWidth disabled={!callbackUrl}>{translate("Connect")}</Button>
                <Button onClick={handleClose} variant="ghost" fullWidth>{translate("Cancel")}</Button>
              </div>
            </div>
          )}
        </>
      )}

      {authMode === "paste-token" && provider && (
        <div className="flex flex-col gap-3">
          {ideStatus && !ideStatus.installed && (
            <div className={`px-3 py-2 rounded-lg text-sm ${PASTE_TOKEN_PROVIDERS[provider].ideOptional ? "bg-blue-500/10 text-blue-700 dark:text-blue-300" : "bg-yellow-500/10 text-yellow-700 dark:text-yellow-300"}`}>
              {PASTE_TOKEN_PROVIDERS[provider].ideName} {translate("IDE not detected.")}
              {PASTE_TOKEN_PROVIDERS[provider].ideOptional
                ? " " + translate("You can still get the token from DevTools.")
                : " " + translate("Install the IDE") + " " + PASTE_TOKEN_PROVIDERS[provider].ideName + " " + translate("to get the token, or use") + ' "' + translate("Sign in with browser") + '".'}
            </div>
          )}
          <p className="text-sm text-text-muted">{PASTE_TOKEN_PROVIDERS[provider].instructions}</p>
          <Input
            value={pasteToken}
            onChange={(e) => setPasteToken(e.target.value)}
            placeholder={PASTE_TOKEN_PROVIDERS[provider].placeholder}
            className="font-mono text-xs"
          />
          <div className="flex gap-2">
            <Button onClick={handleManualSubmit} fullWidth disabled={!pasteToken}>{translate("Connect")}</Button>
            <Button onClick={handleClose} variant="ghost" fullWidth>{translate("Cancel")}</Button>
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Waiting + Manual Input Section (non-device-code, non-proxy)        */
/* ------------------------------------------------------------------ */

interface WaitingInputSectionProps extends CopyActions, ManualSubmitActions {
  isXaiProvider: boolean;
  isKimchiProvider: boolean;
  authData: Record<string, unknown> | null;
  callbackUrl: string;
  manualPlaceholder: string;
  setCallbackUrl: (v: string) => void;
}

export function WaitingInputSection({
  isXaiProvider,
  isKimchiProvider,
  authData,
  callbackUrl,
  manualPlaceholder,
  setCallbackUrl,
  handleManualSubmit,
  handleClose,
  copied,
  copy,
}: WaitingInputSectionProps) {
  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg bg-sidebar/50">
        <Loader2 className="size-4" />
        <span className="text-sm">
          {isXaiProvider ? (translate("Waiting for Grok Build OAuth...") ?? "Waiting for Grok Build OAuth...") : (translate("Waiting for popup authorization...") ?? "Waiting for popup authorization...")}
        </span>
      </div>

      <div className="flex items-center gap-3 my-1">
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-text-muted uppercase tracking-wider">{translate("Or paste callback URL manually")}</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <p className="text-sm font-medium mb-2">
            {translate("Step 1: Open this URL in your browser")} {isXaiProvider ? (translate("Grok Build OAuth URL") ?? "Grok Build OAuth URL") : ""}
          </p>
          <div className="flex gap-2">
            <Input value={(authData?.authUrl as string) || ""} readOnly className="flex-1 font-mono text-xs" />
            <Button variant="secondary" icon={copied === "auth_url" ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={() => copy(authData?.authUrl as string, "auth_url")} disabled={!authData?.authUrl}>
              {translate("Copy")}
            </Button>
          </div>
        </div>

        <div>
          <p className="text-sm font-medium mb-2">
            {translate("Step 2: Paste the callback URL here")} {isXaiProvider ? (translate("or copied code") ?? "or copied code") : isKimchiProvider ? (translate("or copied token") ?? "or copied token") : ""}
          </p>
          <p className="text-xs text-text-muted mb-2">
            {isXaiProvider
              ? (translate("If xAI shows a code instead of redirecting, paste that code here.") ?? "If xAI shows a code instead of redirecting, paste that code here.")
              : isKimchiProvider
                ? (translate("After authorization, copy the complete callback URL or token from your browser.") ?? "After authorization, copy the complete callback URL or token from your browser.")
              : (translate("After authorization, copy the full URL from your browser.") ?? "After authorization, copy the full URL from your browser.")}
          </p>
          <Input
            value={callbackUrl}
            onChange={(e) => setCallbackUrl(e.target.value)}
            placeholder={manualPlaceholder}
            className="font-mono text-xs"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={handleManualSubmit} fullWidth disabled={!callbackUrl}>
          {translate("Connect")}
        </Button>
        <Button onClick={handleClose} variant="ghost" fullWidth>
          {translate("Cancel")}
        </Button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Device Code Flow - Waiting Section                                 */
/* ------------------------------------------------------------------ */

interface DeviceCodeSectionProps extends CopyActions {
  deviceData: Record<string, unknown>;
  deviceLoginUrl: string;
  polling: boolean;
}

export function DeviceCodeSection({
  deviceData,
  deviceLoginUrl,
  polling,
  copied,
  copy,
}: DeviceCodeSectionProps) {
  return (
    <>
      <div className="text-center py-4">
        <p className="text-sm text-text-muted mb-4">
          {translate("Visit the login URL below and authorize:")}
        </p>
        <div className="bg-sidebar p-4 rounded-lg mb-4">
          <p className="text-xs text-text-muted mb-1">{translate("Login URL")}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-sm break-all">{deviceLoginUrl}</code>
            <Button
              size="sm"
              variant="ghost"
              icon={copied === "login_url" ? <Check className="size-4" /> : <Copy className="size-4" />}
              onClick={() => copy(deviceLoginUrl, "login_url")}
              disabled={!deviceLoginUrl}
            />
            <Button
              size="sm"
              variant="ghost"
              icon={<ExternalLink className="size-4" />}
              onClick={() => window.open(deviceLoginUrl, "_blank", "noopener,noreferrer")}
              disabled={!deviceLoginUrl}
            >
              {translate("Open")}
            </Button>
          </div>
        </div>
        <div className="bg-primary/10 p-4 rounded-lg">
          <p className="text-xs text-text-muted mb-1">{translate("Your Code")}</p>
          <div className="flex items-center justify-center gap-2">
            <p className="text-2xl font-mono font-bold text-primary">{deviceData.user_code as string}</p>
            <Button
              size="sm"
              variant="ghost"
              icon={copied === "user_code" ? <Check className="size-4" /> : <Copy className="size-4" />}
              onClick={() => copy(deviceData.user_code as string, "user_code")}
            />
          </div>
        </div>
      </div>
      {polling && (
        <div className="flex items-center justify-center gap-2 text-sm text-text-muted">
          <Loader2 className="size-4" />
          {translate("Waiting for authorization...")}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Success Section                                                    */
/* ------------------------------------------------------------------ */

interface SuccessSectionProps {
  providerInfo: ProviderInfo;
  handleClose: () => void;
}

export function SuccessSection({ providerInfo, handleClose }: SuccessSectionProps) {
  return (
    <div className="text-center py-6">
      <div className="size-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
        <CheckCircle2 className="size-4" />
      </div>
      <h3 className="text-lg font-semibold mb-2">{translate("Connected Successfully!")}</h3>
      <p className="text-sm text-text-muted mb-4">
        {translate("Your account") + " " + providerInfo.name + " " + translate("has been connected.")}
      </p>
      <Button onClick={handleClose} fullWidth>
        {translate("Done")}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Error Section                                                      */
/* ------------------------------------------------------------------ */

interface ErrorSectionProps {
  error: string | null;
  startOAuthFlow: () => Promise<void>;
  handleClose: () => void;
}

export function ErrorSection({ error, startOAuthFlow, handleClose }: ErrorSectionProps) {
  return (
    <div className="text-center py-6">
      <div className="size-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
        <AlertCircle className="size-4" />
      </div>
      <h3 className="text-lg font-semibold mb-2">{translate("Connection Failed")}</h3>
      <p className="text-sm text-red-600 mb-4">{error}</p>
      <div className="flex gap-2">
        <Button onClick={startOAuthFlow} variant="secondary" fullWidth>
          {translate("Try Again")}
        </Button>
        <Button onClick={handleClose} variant="ghost" fullWidth>
          {translate("Cancel")}
        </Button>
      </div>
    </div>
  );
}



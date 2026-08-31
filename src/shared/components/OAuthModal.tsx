"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import Button from "@/shared/components/Button";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { useOAuthFlow, PROXY_OAUTH_PROVIDERS, type ProviderInfo } from "./useOAuthFlow";
import { ProxyOAuthSection, WaitingInputSection, DeviceCodeSection, SuccessSection, ErrorSection } from "./OAuthModalSections";

interface OAuthModalProps {
  isOpen: boolean;
  provider?: string;
  providerInfo?: ProviderInfo;
  onSuccess?: () => void;
  onClose: () => void;
  /** Extra metadata passed to /authorize and /exchange (e.g. gitlab clientId/baseUrl) */
  oauthMeta?: Record<string, string>;
  /** Optional Kiro IDC config for AWS IAM Identity Center device flow */
  idcConfig?: {
    startUrl?: string;
    region?: string;
  };
}

/**
 * OAuth Modal Component
 * - Localhost: Auto callback via popup message
 * - Remote: Manual paste callback URL
 */
export default function OAuthModal({ isOpen, provider, providerInfo, onSuccess, onClose, oauthMeta, idcConfig }: OAuthModalProps) {
  const flow = useOAuthFlow({ isOpen, provider, onSuccess, onClose, oauthMeta, idcConfig });

  if (!provider || !providerInfo) return null;

  const isXaiProvider = provider === "xai";
  const isKimchiProvider = provider === "kimchi";
  const deviceLoginUrl = (flow.deviceData?.verification_uri_complete as string) || (flow.deviceData?.verification_uri as string) || "";
  const modalTitle = isXaiProvider ? (translate("Connect Grok Build OAuth") ?? "Connect Grok Build OAuth") : (translate("Connect") + " " + providerInfo.name);
  const manualPlaceholder = isXaiProvider
    ? "http://127.0.0.1:56121/callback?code=... or copied code"
    : isKimchiProvider
      ? `${flow.placeholderUrl.replace("code=...", "token=...")} or copied token`
      : flow.placeholderUrl;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && flow.handleClose()}>
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
            {modalTitle}
          </DialogTitle>
          <Button onClick={flow.handleClose} aria-label={translate("Close") ?? "Close"} variant="ghost" size="sm" className="p-1.5">
            <X className="size-5" />
          </Button>
        </div>
        <div className="p-6 max-h-[calc(85vh-100px)] overflow-y-auto custom-scrollbar">
          <div className="flex flex-col gap-4">
        {/* Trae/Windsurf: browser OAuth (proxy) + paste-token fallback */}
        {provider && PROXY_OAUTH_PROVIDERS.has(provider) && (flow.step === "waiting" || flow.step === "input" || flow.step === "error") && (
          <ProxyOAuthSection
            provider={provider}
            step={flow.step}
            authMode={flow.authMode}
            callbackUrl={flow.callbackUrl}
            pasteToken={flow.pasteToken}
            ideStatus={flow.ideStatus}
            error={flow.error}
            setAuthMode={flow.setAuthMode}
            setError={flow.setError}
            setStep={flow.setStep}
            setCallbackUrl={flow.setCallbackUrl}
            setPasteToken={flow.setPasteToken}
            startOAuthFlow={flow.startOAuthFlow}
            handleManualSubmit={flow.handleManualSubmit}
            handleClose={flow.handleClose}
            copied={flow.copied}
            copy={flow.copy}
          />
        )}

        {/* Waiting + Manual Input combined (non-device-code, non-proxy) */}
        {(flow.step === "waiting" || flow.step === "input") && !flow.isDeviceCode && !(provider && PROXY_OAUTH_PROVIDERS.has(provider)) && (
          <WaitingInputSection
            isXaiProvider={isXaiProvider}
            isKimchiProvider={isKimchiProvider}
            authData={flow.authData}
            callbackUrl={flow.callbackUrl}
            manualPlaceholder={manualPlaceholder}
            setCallbackUrl={flow.setCallbackUrl}
            handleManualSubmit={flow.handleManualSubmit}
            handleClose={flow.handleClose}
            copied={flow.copied}
            copy={flow.copy}
          />
        )}

        {/* Device Code Flow - Waiting */}
        {flow.step === "waiting" && flow.isDeviceCode && flow.deviceData && (
          <DeviceCodeSection
            deviceData={flow.deviceData}
            deviceLoginUrl={deviceLoginUrl}
            polling={flow.polling}
            copied={flow.copied}
            copy={flow.copy}
          />
        )}

        {/* Success Step */}
        {flow.step === "success" && (
          <SuccessSection providerInfo={providerInfo} handleClose={flow.handleClose} />
        )}

        {/* Error Step */}
        {flow.step === "error" && (
          <ErrorSection error={flow.error} startOAuthFlow={flow.startOAuthFlow} handleClose={flow.handleClose} />
        )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

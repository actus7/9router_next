"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { useKiroAuthFlow } from "./useKiroAuthFlow";
import { MethodSelectionSection, IdcConfigSection, ApiKeySection, SocialGoogleSection, SocialGithubSection, ImportTokenSection, ImportCliProxySection } from "./KiroAuthModalSections";

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
  const flow = useKiroAuthFlow({ isOpen, onMethodSelect });

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
            {translate("Connect Kiro")}
          </DialogTitle>
          <Button onClick={onClose} aria-label={translate("Close") ?? "Close"} variant="ghost" size="sm" className="p-1.5">
            <X className="size-5" />
          </Button>
        </div>
        <div className="p-6 max-h-[calc(85vh-100px)] overflow-y-auto custom-scrollbar">
          <div className="flex flex-col gap-4">
        {/* Method Selection */}
        {!flow.selectedMethod && (
          <MethodSelectionSection
            onBuilderIdClick={() => onMethodSelect("builder-id")}
            onMethodClick={flow.handleMethodSelect}
          />
        )}

        {/* IDC Configuration */}
        {flow.selectedMethod === "idc" && (
          <IdcConfigSection
            idcStartUrl={flow.idcStartUrl}
            setIdcStartUrl={flow.setIdcStartUrl}
            idcRegion={flow.idcRegion}
            setIdcRegion={flow.setIdcRegion}
            error={flow.error}
            handleIdcContinue={flow.handleIdcContinue}
            handleBack={flow.handleBack}
          />
        )}

        {/* API Key */}
        {flow.selectedMethod === "api-key" && (
          <ApiKeySection
            apiKey={flow.apiKey}
            setApiKey={flow.setApiKey}
            apiKeyRegion={flow.apiKeyRegion}
            setApiKeyRegion={flow.setApiKeyRegion}
            error={flow.error}
            importing={flow.importing}
            handleApiKeyImport={flow.handleApiKeyImport}
            handleBack={flow.handleBack}
          />
        )}

        {/* Social Login Info (Google) */}
        {flow.selectedMethod === "social-google" && (
          <SocialGoogleSection
            handleSocialLogin={flow.handleSocialLogin}
            handleBack={flow.handleBack}
          />
        )}

        {/* Social Login Info (GitHub) */}
        {flow.selectedMethod === "social-github" && (
          <SocialGithubSection
            handleSocialLogin={flow.handleSocialLogin}
            handleBack={flow.handleBack}
          />
        )}

        {/* Import Token */}
        {flow.selectedMethod === "import" && (
          <ImportTokenSection
            autoDetecting={flow.autoDetecting}
            autoDetected={flow.autoDetected}
            error={flow.error}
            refreshToken={flow.refreshToken}
            setRefreshToken={flow.setRefreshToken}
            importing={flow.importing}
            handleImportToken={flow.handleImportToken}
            handleBack={flow.handleBack}
          />
        )}

        {/* Import CLIProxyAPI JSON */}
        {flow.selectedMethod === "import-cli-proxy" && (
          <ImportCliProxySection
            cliProxyJson={flow.cliProxyJson}
            setCliProxyJson={flow.setCliProxyJson}
            error={flow.error}
            importing={flow.importing}
            handleImportCliProxyJson={flow.handleImportCliProxyJson}
            handleBack={flow.handleBack}
          />
        )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import Button from "@/shared/components/Button";
import { cn } from "@/lib/utils";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { X } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { useKiroSocialAuth } from "./useKiroSocialAuth";
import { KiroSocialLoading, KiroSocialInput, KiroSocialSuccess, KiroSocialError } from "./KiroSocialSteps";

interface KiroSocialOAuthModalProps {
  isOpen: boolean; provider: "google" | "github"; onSuccess?: () => void; onClose: () => void;
}

export default function KiroSocialOAuthModal({ isOpen, provider, onSuccess, onClose }: KiroSocialOAuthModalProps) {
  const { step, authUrl, callbackUrl, setCallbackUrl, error, handleManualSubmit } = useKiroSocialAuth(isOpen, provider, onSuccess);
  const { copied, copy } = useCopyToClipboard();
  const providerName = provider === "google" ? "Google" : "GitHub";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className={cn("bg-surface border border-border-subtle rounded-[14px]", "shadow-[var(--shadow-elev)] ring-0 gap-0 p-0", "max-w-lg")}>
        <div className="flex items-center justify-between p-2 border-b border-border-subtle">
          <DialogTitle className="text-lg font-semibold text-text-main ml-2">{translate("Connect Kiro via") + " " + providerName}</DialogTitle>
          <Button onClick={onClose} aria-label={translate("Close") ?? "Close"} variant="ghost" size="sm" className="p-1.5"><X className="size-5" /></Button>
        </div>
        <div className="p-6 max-h-[calc(85vh-100px)] overflow-y-auto custom-scrollbar">
          <div className="flex flex-col gap-4">
            {step === "loading" && <KiroSocialLoading providerName={providerName} />}
            {step === "input" && <KiroSocialInput authUrl={authUrl} callbackUrl={callbackUrl} setCallbackUrl={setCallbackUrl} copied={copied} copy={copy} onSubmit={handleManualSubmit} onClose={onClose} />}
            {step === "success" && <KiroSocialSuccess providerName={providerName} onClose={onClose} />}
            {step === "error" && <KiroSocialError error={error} onRetry={() => {}} onClose={onClose} />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import Button from "@/shared/components/Button";
import Input from "@/shared/components/Input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";
import { translate } from "@/i18n/runtime";

interface IFlowCookieModalProps {
  isOpen: boolean;
  onSuccess?: () => void;
  onClose?: () => void;
}

/**
 * iFlow Cookie Authentication Modal
 * User pastes browser cookie to get fresh API key
 */
export default function IFlowCookieModal({ isOpen, onSuccess, onClose }: IFlowCookieModalProps) {
  const [cookie, setCookie] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);

  const handleSubmit = async () => {
    if (!cookie.trim()) {
      setError("Please paste your cookie");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/iflow/cookie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookie: cookie.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Authentication failed");
      }

      setSuccess(true);
      setTimeout(() => {
        onSuccess?.();
        handleClose();
      }, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setCookie("");
    setError(null);
    setSuccess(false);
    onClose?.();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "bg-surface border border-border-subtle rounded-[14px]",
          "shadow-[var(--shadow-elev)] ring-0 gap-0 p-0",
          "max-w-md"
        )}
      >
        <div className="flex items-center justify-between p-2 border-b border-border-subtle">
          <DialogTitle className="text-lg font-semibold text-text-main ml-2">
            {translate("iFlow Cookie Authentication")}
          </DialogTitle>
          <Button onClick={handleClose} aria-label={translate("Close") ?? "Close"} variant="ghost" size="sm" className="p-1.5">
            <X className="size-5" />
          </Button>
        </div>
        <div className="p-6 max-h-[calc(85vh-100px)] overflow-y-auto custom-scrollbar">
          <div className="space-y-4">
        {success ? (
          <div className="text-center py-8">
            <div className="text-6xl mb-4">✅</div>
            <p className="text-lg font-medium text-text-primary">{translate("Authentication Successful!")}</p>
            <p className="text-sm text-text-muted mt-2">{translate("Fresh API key obtained")}</p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <p className="text-sm text-text-muted">
                {translate("To get a fresh API key, paste your browser cookie from")}{" "}
                <a
                  href="https://platform.iflow.cn"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  platform.iflow.cn
                </a>
              </p>
              <div className="bg-surface-secondary p-3 rounded-lg text-xs space-y-2">
                <p className="font-medium text-text-primary">{translate("How to get cookie:")}</p>
                <ol className="list-decimal list-inside space-y-1 text-text-muted">
                  <li>{translate("Open platform.iflow.cn in your browser")}</li>
                  <li>{translate("Log in to your account")}</li>
                  <li>{translate("Open DevTools (F12) → Application/Storage → Cookies")}</li>
                  <li>{translate("Copy the entire cookie string (must include BXAuth)")}</li>
                  <li>{translate("Paste it below")}</li>
                </ol>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="block text-text-primary">
                {translate("Cookie String")}
              </Label>
              <Textarea
                value={cookie}
                onChange={(e) => setCookie(e.target.value)}
                placeholder="BXAuth=xxx; ..."
                className="resize-none"
                rows={4}
                disabled={loading}
              />
            </div>

            {error && (
              <div className="p-3 bg-error/10 border border-error/20 rounded-lg">
                <p className="text-sm text-error">{error}</p>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button variant="secondary" onClick={handleClose} disabled={loading} fullWidth>
                {translate("Cancel")}
              </Button>
              <Button onClick={handleSubmit} loading={loading} fullWidth>
                {translate("Authenticate")}
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

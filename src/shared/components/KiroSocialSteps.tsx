"use client";

import { Button } from "@/components/ui/button";
import { FormInput as Input } from "@/shared/components/FormInput";
import { AlertCircle, Check, CheckCircle2, Copy, Loader2 } from "lucide-react";
import { translate } from "@/i18n/runtime";

export function KiroSocialLoading({ providerName }: { providerName: string }) {
  return (
    <div className="text-center py-6">
      <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center"><Loader2 className="size-4" /></div>
      <h3 className="text-lg font-semibold mb-2">{translate("Initializing...")}</h3>
      <p className="text-sm text-text-muted">{translate("Setting up authentication") + " " + providerName}</p>
    </div>
  );
}

export function KiroSocialSuccess({ providerName, onClose }: { providerName: string; onClose: () => void }) {
  return (
    <div className="text-center py-6">
      <div className="size-16 mx-auto mb-4 rounded-full bg-success dark:bg-success flex items-center justify-center"><CheckCircle2 className="size-4" /></div>
      <h3 className="text-lg font-semibold mb-2">{translate("Connected Successfully!")}</h3>
      <p className="text-sm text-text-muted mb-4">{translate("Your Kiro account via") + " " + providerName + " " + translate("has been connected.")}</p>
      <Button onClick={onClose} fullWidth>{translate("Done")}</Button>
    </div>
  );
}

export function KiroSocialError({ error, onRetry, onClose }: { error: string | null; onRetry: () => void; onClose: () => void }) {
  return (
    <div className="text-center py-6">
      <div className="size-16 mx-auto mb-4 rounded-full bg-destructive dark:bg-destructive flex items-center justify-center"><AlertCircle className="size-4" /></div>
      <h3 className="text-lg font-semibold mb-2">{translate("Connection Failed")}</h3>
      <p className="text-sm text-destructive-foreground mb-4">{error}</p>
      <div className="flex gap-2">
        <Button onClick={onRetry} variant="secondary" fullWidth>{translate("Try Again")}</Button>
        <Button onClick={onClose} variant="ghost" fullWidth>{translate("Cancel")}</Button>
      </div>
    </div>
  );
}

interface KiroSocialInputProps {
  authUrl: string; callbackUrl: string; setCallbackUrl: (v: string) => void;
  copied: string | null; copy: (text: string, id: string) => void;
  onSubmit: () => void; onClose: () => void;
}

export function KiroSocialInput({ authUrl, callbackUrl, setCallbackUrl, copied, copy, onSubmit, onClose }: KiroSocialInputProps) {
  return (
    <>
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-sm font-medium mb-2">{translate("Step 1: Open this URL in your browser")}</p>
          <div className="flex gap-2">
            <Input value={authUrl} readOnly className="flex-1 font-mono text-xs" />
            <Button variant="secondary" icon={copied === "auth_url" ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={() => copy(authUrl, "auth_url")}>{translate("Copy")}</Button>
          </div>
        </div>
        <div>
          <p className="text-sm font-medium mb-2">{translate("Step 2: Paste the callback URL here")}</p>
          <p className="text-xs text-text-muted mb-2">{translate("After authorization, copy the full URL from your browser address bar.")}</p>
          <Input value={callbackUrl} onChange={(e) => setCallbackUrl(e.target.value)} placeholder="kiro://kiro.kiroAgent/authenticate-success?code=..." className="font-mono text-xs" />
        </div>
      </div>
      <div className="flex gap-2">
        <Button onClick={onSubmit} fullWidth disabled={!callbackUrl}>{translate("Connect")}</Button>
        <Button onClick={onClose} variant="ghost" fullWidth>{translate("Cancel")}</Button>
      </div>
    </>
  );
}



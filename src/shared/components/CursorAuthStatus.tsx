"use client";

import { Button } from "@/components/ui/button";
import { CheckCircle2, Info, Loader2 } from "lucide-react";
import { translate } from "@/i18n/runtime";

interface CursorAuthStatusProps {
  autoDetecting: boolean;
  autoDetected: boolean;
  windowsManual: boolean;
  error: string | null;
  onRetry: () => void;
}

export function CursorAuthStatus({ autoDetecting, autoDetected, windowsManual, error, onRetry }: CursorAuthStatusProps) {
  if (autoDetecting) {
    return (
      <div className="text-center py-6">
        <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center"><Loader2 className="size-4" /></div>
        <h3 className="text-lg font-semibold mb-2">{translate("Auto-detecting tokens...")}</h3>
        <p className="text-sm text-text-muted">{translate("Reading from Cursor IDE database")}</p>
      </div>
    );
  }
  return (
    <>
      {autoDetected && (
        <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg border border-green-200 dark:border-green-800">
          <div className="flex gap-2"><CheckCircle2 className="size-4" /><p className="text-sm text-green-800 dark:text-green-200">{translate("Tokens auto-detected from Cursor IDE successfully!")}</p></div>
        </div>
      )}
      {windowsManual && (
        <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800 flex flex-col gap-2">
          <div className="flex gap-2 items-center"><Info className="size-4" /><p className="text-sm font-medium text-amber-800 dark:text-amber-200">{translate("Could not read Cursor database automatically.")}</p></div>
          <p className="text-xs text-amber-700 dark:text-amber-300">{translate("Make sure Cursor IDE has been opened at least once, then click")} <strong>{translate("Try Again")}</strong>. {translate("If the problem persists, paste your tokens manually below.")}</p>
          <Button onClick={onRetry} variant="outline" fullWidth>{translate("Try Again")}</Button>
        </div>
      )}
      {!autoDetected && !windowsManual && !error && (
        <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
          <div className="flex gap-2"><Info className="size-4" /><p className="text-sm text-blue-800 dark:text-blue-200">{translate("Cursor IDE not detected. Please paste your tokens manually.")}</p></div>
        </div>
      )}
    </>
  );
}

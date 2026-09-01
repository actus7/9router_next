"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import Button from "@/shared/components/Button";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { useCursorAuth } from "./useCursorAuth";
import { CursorAuthStatus } from "./CursorAuthStatus";
import { CursorAuthForm } from "./CursorAuthForm";

interface CursorAuthModalProps {
  isOpen: boolean; onSuccess?: () => void; onClose: () => void;
}

export default function CursorAuthModal({ isOpen, onSuccess, onClose }: CursorAuthModalProps) {
  const c = useCursorAuth(isOpen);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className={cn("bg-surface border border-border-subtle rounded-[14px]", "shadow-[var(--shadow-elev)] ring-0 gap-0 p-0", "max-w-md")}>
        <div className="flex items-center justify-between p-2 border-b border-border-subtle">
          <DialogTitle className="text-lg font-semibold text-text-main ml-2">{translate("Connect Cursor IDE")}</DialogTitle>
          <Button onClick={onClose} aria-label={translate("Close") ?? "Close"} variant="ghost" size="sm" className="p-1.5"><X className="size-5" /></Button>
        </div>
        <div className="p-6 max-h-[calc(85vh-100px)] overflow-y-auto custom-scrollbar">
          <div className="flex flex-col gap-4">
            <CursorAuthStatus autoDetecting={c.autoDetecting} autoDetected={c.autoDetected} windowsManual={c.windowsManual} error={c.error} onRetry={c.runAutoDetect} />
            {!c.autoDetecting && (
              <CursorAuthForm accessToken={c.accessToken} setAccessToken={c.setAccessToken} machineId={c.machineId} setMachineId={c.setMachineId} error={c.error} importing={c.importing} onImport={() => c.handleImportToken(onSuccess, onClose)} onClose={onClose} />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

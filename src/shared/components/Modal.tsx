"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import Button from "./Button";
import Tooltip from "./Tooltip";

type ModalSize = "sm" | "md" | "lg" | "xl" | "full";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  closeOnOverlay?: boolean;
  showTrafficLights?: boolean;
  className?: string;
}

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = "md",
  closeOnOverlay = true,
  showTrafficLights = true,
  className,
}: ModalProps) {
  const sizes: Record<ModalSize, string> = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    full: "max-w-4xl",
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      disablePointerDismissal={!closeOnOverlay}
    >
      <DialogContent
        showCloseButton={false}
        className={cn(
          "bg-surface border border-border-subtle rounded-[14px]",
          "shadow-[var(--shadow-elev)] ring-0 gap-0 p-0",
          sizes[size],
          className
        )}
      >
        {/* Header */}
        {(title || showTrafficLights) && (
          <div className="flex items-center justify-between p-2 border-b border-border-subtle">
            <div className="flex items-center">
              {/* Traffic lights — desktop only */}
              {showTrafficLights && (
                <div className="hidden md:flex items-center gap-2 mr-4 ml-2">
                  <Tooltip text="Close" position="top" color="#FF5F56">
                    <Button
                      onClick={onClose}
                      aria-label="Close"
                      title="Close"
                      variant="ghost"
                      size="icon-xs"
                      className="w-4 h-4 rounded-full bg-[#FF5F56] hover:brightness-90 transition-all cursor-pointer flex items-center justify-center group/dot"
                    >
                      <span className="text-[9px] font-bold text-white opacity-0 group-hover/dot:opacity-100 transition-opacity leading-none">
                        ✕
                      </span>
                    </Button>
                  </Tooltip>
                  <div className="w-4 h-4 rounded-full bg-[#3a3a3a]/20 dark:bg-white/15 cursor-not-allowed" />
                  <div className="w-4 h-4 rounded-full bg-[#3a3a3a]/20 dark:bg-white/15 cursor-not-allowed" />
                </div>
              )}
              {title && (
                <DialogTitle className="text-lg font-semibold text-text-main">
                  {title}
                </DialogTitle>
              )}
            </div>
            {/* X button — mobile only */}
            <Button
              onClick={onClose}
              aria-label="Close"
              variant="ghost"
              size="sm"
              className="md:hidden p-1.5"
            >
              <span className="material-symbols-outlined text-[20px]">
                close
              </span>
            </Button>
          </div>
        )}

        {/* Body */}
        <div className="p-6 max-h-[calc(85vh-100px)] overflow-y-auto custom-scrollbar">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <DialogFooter className="flex items-center justify-end gap-3 p-6 border-t border-border-subtle rounded-b-xl">
            {footer}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  variant?:
    | "primary"
    | "secondary"
    | "outline"
    | "ghost"
    | "danger"
    | "success";
  loading?: boolean;
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = "Confirm",
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger",
  loading = false,
}: ConfirmModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {cancelText}
          </Button>
          <Button variant={variant} onClick={onConfirm} loading={loading}>
            {confirmText}
          </Button>
        </>
      }
    >
      <p className="text-text-muted">{message}</p>
    </Modal>
  );
}

"use client";

import { type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@/lib/utils";
import Button from "@/shared/components/Button";
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTitle,
} from "@/components/ui/dialog";

type DrawerWidth = "sm" | "md" | "lg" | "xl" | "full";

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  width?: DrawerWidth;
  className?: string;
}

export default function Drawer({
  isOpen,
  onClose,
  title,
  children,
  width = "md",
  className,
}: DrawerProps) {
  const widths: Record<DrawerWidth, string> = {
    sm: "w-[400px]",
    md: "w-[500px]",
    lg: "w-[600px]",
    xl: "w-[800px]",
    full: "w-full",
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Popup
          data-slot="drawer-content"
          className={cn(
            "fixed right-0 top-0 z-50 h-full flex flex-col",
            "bg-surface shadow-[var(--shadow-elev)]",
            "border-l border-border-subtle",
            "outline-none",
            "data-open:animate-in data-open:slide-in-from-right data-open:duration-200",
            "data-closed:animate-out data-closed:slide-out-to-right data-closed:duration-200",
            widths[width] || widths.md,
            className
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-border-subtle flex-shrink-0">
            <div className="flex items-center gap-3">
              {title && (
                <DialogTitle className="text-lg font-semibold text-text-main">
                  {title}
                </DialogTitle>
              )}
            </div>
            <Button
              type="button"
              onClick={onClose}
              aria-label="Close drawer"
              variant="ghost"
              size="icon-sm"
            >
              <span className="material-symbols-outlined text-[20px]">
                close
              </span>
            </Button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            {children}
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}

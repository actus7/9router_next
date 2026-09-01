"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { X } from "lucide-react";

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
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        className={cn(
          "gap-0 bg-surface p-0 shadow-[var(--shadow-elev)]",
          "border-l border-border-subtle",
          widths[width] || widths.md,
          className
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border-subtle flex-shrink-0">
          <div className="flex items-center gap-3">
            {title && (
              <SheetTitle className="text-lg font-semibold text-text-main">
                {title}
              </SheetTitle>
            )}
          </div>
          <Button
            type="button"
            onClick={onClose}
            aria-label="Fechar painel"
            variant="ghost"
            size="icon-sm"
          >
            <X className="size-5" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}

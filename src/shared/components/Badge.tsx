"use client";

import React from "react";
import { Badge as ShadcnBadge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "primary" | "success" | "warning" | "error" | "info";
type BadgeSize = "sm" | "md" | "lg";

interface BadgeProps {
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  icon?: string;
  className?: string;
  children?: React.ReactNode;
}

const variantToShadcn: Record<BadgeVariant, string> = {
  default: "secondary",
  primary: "default",
  success: "default",
  warning: "default",
  error: "destructive",
  info: "default",
};

const variantOverrides: Partial<Record<BadgeVariant, string>> = {
  success: "bg-green-500/10 text-green-600 dark:text-green-400",
  warning: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  info: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
};

const sizeClasses: Record<BadgeSize, string> = {
  sm: "h-auto px-2 py-0.5 text-[10px]",
  md: "h-auto px-2.5 py-1 text-xs",
  lg: "h-auto px-3 py-1.5 text-sm",
};

export default function Badge({
  children,
  variant = "default",
  size = "md",
  dot = false,
  icon,
  className,
}: BadgeProps) {
  return (
    <ShadcnBadge
      variant={variantToShadcn[variant] as any}
      className={cn(sizeClasses[size], variantOverrides[variant], className)}
    >
      {dot && (
        <span
          className={cn(
            "size-1.5 rounded-full",
            variant === "success" && "bg-green-500",
            variant === "warning" && "bg-yellow-500",
            variant === "error" && "bg-red-500",
            variant === "info" && "bg-blue-500",
            variant === "primary" && "bg-brand-500",
            variant === "default" && "bg-gray-500"
          )}
        />
      )}
      {icon && (
        <span className="material-symbols-outlined text-[14px]">{icon}</span>
      )}
      {children}
    </ShadcnBadge>
  );
}

"use client";

import React from "react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type ToggleSize = "sm" | "md" | "lg";

interface ToggleProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  size?: ToggleSize;
  className?: string;
}

const sizeToShadcn: Record<ToggleSize, "sm" | "default"> = {
  sm: "sm",
  md: "default",
  lg: "default",
};

export default function Toggle({
  checked = false,
  onChange,
  label,
  description,
  disabled = false,
  size = "md",
  className,
}: ToggleProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3",
        disabled && "opacity-50",
        className
      )}
    >
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        size={sizeToShadcn[size]}
      />
      {(label || description) && (
        <div className="flex flex-col">
          {label && (
            <span className="text-sm font-medium text-text-main">{label}</span>
          )}
          {description && (
            <span className="text-xs text-text-muted">{description}</span>
          )}
        </div>
      )}
    </div>
  );
}

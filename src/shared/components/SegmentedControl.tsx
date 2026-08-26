"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type SegmentedControlSize = "sm" | "md" | "lg";

interface SegmentedControlOption {
  value: string;
  label: string;
  icon?: string;
}

interface SegmentedControlProps {
  options?: SegmentedControlOption[];
  value?: string;
  onChange?: (value: string) => void;
  size?: SegmentedControlSize;
  className?: string;
}

export default function SegmentedControl({
  options = [],
  value,
  onChange,
  size = "md",
  className,
}: SegmentedControlProps) {
  const sizes: Record<SegmentedControlSize, string> = {
    sm: "h-7 text-xs",
    md: "h-9 text-sm",
    lg: "h-11 text-base",
  };

  return (
    <Tabs
      value={value}
      onValueChange={(v) => onChange?.(String(v))}
      className={cn("inline-flex", className)}
    >
      <TabsList
        variant="default"
        className="rounded-[10px] bg-surface-2 p-1"
      >
        {options.map((option) => (
          <TabsTrigger
            key={option.value}
            value={option.value}
            className={cn(
              "shrink-0 flex-none px-4 rounded-[8px] font-medium transition-all",
              sizes[size],
              "data-active:bg-surface data-active:text-text-main data-active:shadow-sm",
              "text-text-muted hover:text-text-main"
            )}
          >
            {option.icon && (
              <span className="material-symbols-outlined text-[16px] mr-1.5">
                {option.icon}
              </span>
            )}
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Skeleton as ShadcnSkeleton } from "@/components/ui/skeleton";

type SpinnerSize = "sm" | "md" | "lg" | "xl";

interface SpinnerProps {
  size?: SpinnerSize;
  className?: string;
}

interface CardSkeletonProps {}

// Spinner loading
export function Spinner({ size = "md", className }: SpinnerProps) {
  const sizes: Record<SpinnerSize, string> = {
    sm: "size-4",
    md: "size-6",
    lg: "size-8",
    xl: "size-12",
  };

  return (
    <span
      className={cn(
        "material-symbols-outlined animate-spin text-brand-500",
        sizes[size],
        className
      )}
    >
      progress_activity
    </span>
  );
}

// Card skeleton
export function CardSkeleton(_props: CardSkeletonProps) {
  return (
    <div className="p-6 rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between mb-4">
        <ShadcnSkeleton className="h-4 w-24 rounded-[10px] bg-surface-2" />
        <ShadcnSkeleton className="size-10 rounded-[10px] bg-surface-2" />
      </div>
      <ShadcnSkeleton className="h-8 w-16 mb-2 rounded-[10px] bg-surface-2" />
      <ShadcnSkeleton className="h-3 w-20 rounded-[10px] bg-surface-2" />
    </div>
  );
}

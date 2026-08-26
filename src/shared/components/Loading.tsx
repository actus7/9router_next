"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Skeleton as ShadcnSkeleton } from "@/components/ui/skeleton";

type SpinnerSize = "sm" | "md" | "lg" | "xl";
type LoadingType = "spinner" | "page" | "skeleton" | "card";

interface SpinnerProps {
  size?: SpinnerSize;
  className?: string;
}

interface PageLoadingProps {
  message?: string;
}

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

interface CardSkeletonProps {}

interface LoadingProps {
  type?: LoadingType;
  [key: string]: unknown;
}

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

// Full page loading
function PageLoading({ message = "Loading..." }: PageLoadingProps) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-bg">
      <Spinner size="xl" />
      <p className="mt-4 text-text-muted">{message}</p>
    </div>
  );
}

// Skeleton loading — delegates to shadcn Skeleton
function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <ShadcnSkeleton
      className={cn("rounded-[10px] bg-surface-2", className)}
      {...props}
    />
  );
}

// Card skeleton
export function CardSkeleton(_props: CardSkeletonProps) {
  return (
    <div className="p-6 rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="size-10 rounded-[10px]" />
      </div>
      <Skeleton className="h-8 w-16 mb-2" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

function Loading({ type = "spinner", ...props }: LoadingProps) {
  switch (type) {
    case "page":
      return <PageLoading {...(props as PageLoadingProps)} />;
    case "skeleton":
      return <Skeleton {...(props as SkeletonProps)} />;
    case "card":
      return <CardSkeleton {...(props as CardSkeletonProps)} />;
    default:
      return <Spinner {...(props as SpinnerProps)} />;
  }
}

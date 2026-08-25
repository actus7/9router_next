"use client";

import React from "react";
import { cn } from "@/lib/utils";
import {
  Card as ShadcnCard,
  CardHeader,
  CardTitle as ShadcnCardTitle,
  CardDescription,
  CardAction,
  CardContent,
} from "@/components/ui/card";

type CardPadding = "none" | "xs" | "sm" | "md" | "lg";

interface CardProps extends React.ComponentProps<typeof ShadcnCard> {
  title?: string;
  subtitle?: string;
  icon?: string;
  action?: React.ReactNode;
  padding?: CardPadding;
  hover?: boolean;
  elev?: boolean;
  className?: string;
  children?: React.ReactNode;
}

interface CardSectionProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
}

interface CardRowProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
}

interface CardListItemProps extends React.HTMLAttributes<HTMLDivElement> {
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

const paddingVars: Record<CardPadding, string> = {
  none: "[--card-spacing:0px]",
  xs: "[--card-spacing:--spacing(3)]",
  sm: "[--card-spacing:--spacing(4)]",
  md: "[--card-spacing:--spacing(6)]",
  lg: "[--card-spacing:--spacing(8)]",
};

export default function Card({
  children,
  title,
  subtitle,
  icon,
  action,
  padding = "md",
  hover = false,
  elev = false,
  className,
  ...props
}: CardProps) {
  return (
    <ShadcnCard
      className={cn(
        "bg-surface border border-border-subtle rounded-[14px] ring-0",
        elev
          ? "shadow-[var(--shadow-elev)]"
          : "shadow-[var(--shadow-soft)]",
        hover &&
          "hover:shadow-[var(--shadow-warm)] hover:border-brand-500/30 transition-all cursor-pointer",
        paddingVars[padding],
        className
      )}
      {...props}
    >
      {(title || action) && (
        <CardHeader>
          <div className="flex items-center gap-3">
            {icon && (
              <div className="p-2 rounded-[10px] bg-bg text-text-muted">
                <span className="material-symbols-outlined text-[20px]">
                  {icon}
                </span>
              </div>
            )}
            <div className="grid gap-1">
              {title && (
                <ShadcnCardTitle className="text-text-main font-semibold">
                  {title}
                </ShadcnCardTitle>
              )}
              {subtitle && (
                <CardDescription className="text-sm text-text-muted">
                  {subtitle}
                </CardDescription>
              )}
            </div>
          </div>
          {action && <CardAction>{action}</CardAction>}
        </CardHeader>
      )}
      <CardContent>{children}</CardContent>
    </ShadcnCard>
  );
}

Card.Section = function CardSection({
  children,
  className,
  ...props
}: CardSectionProps) {
  return (
    <div
      className={cn(
        "p-4 rounded-[10px]",
        "bg-bg border border-border-subtle",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

Card.Row = function CardRow({
  children,
  className,
  ...props
}: CardRowProps) {
  return (
    <div
      className={cn(
        "p-3 -mx-3 px-3 transition-colors",
        "border-b border-border-subtle last:border-b-0",
        "hover:bg-surface-2/50",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

Card.ListItem = function CardListItem({
  children,
  actions,
  className,
  ...props
}: CardListItemProps) {
  return (
    <div
      className={cn(
        "group flex items-center justify-between p-3 -mx-3 px-3",
        "border-b border-border-subtle last:border-b-0",
        "hover:bg-surface-2/50 transition-colors",
        className
      )}
      {...props}
    >
      <div className="flex-1 min-w-0">{children}</div>
      {actions && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {actions}
        </div>
      )}
    </div>
  );
};

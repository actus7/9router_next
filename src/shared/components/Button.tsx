"use client";

import React from "react";
import { Button as ShadcnButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "success" | "default" | "destructive" | "link";
type ButtonSize = "sm" | "md" | "lg" | "xs" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";

interface ButtonProps extends Omit<React.ComponentProps<typeof ShadcnButton>, "variant" | "size"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
  className?: string;
  children?: React.ReactNode;
}

const variantToShadcn: Record<ButtonVariant, string> = {
  primary: "default",
  secondary: "secondary",
  outline: "outline",
  ghost: "ghost",
  danger: "destructive",
  success: "default",
  default: "default",
  destructive: "destructive",
  link: "link",
};

const sizeToShadcn: Record<ButtonSize, string> = {
  xs: "xs",
  sm: "sm",
  md: "default",
  lg: "lg",
  icon: "icon",
  "icon-xs": "icon-xs",
  "icon-sm": "icon-sm",
  "icon-lg": "icon-lg",
};

export default function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  loading = false,
  fullWidth = false,
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <ShadcnButton
      variant={variantToShadcn[variant] as React.ComponentProps<typeof ShadcnButton>["variant"]}
      size={sizeToShadcn[size] as React.ComponentProps<typeof ShadcnButton>["size"]}
      disabled={disabled || loading}
      className={cn(
        variant === "success" &&
          "bg-green-600 text-white shadow-sm hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700",
        fullWidth && "w-full",
        className
      )}
      {...props}
    >
      {loading ? (
        <Loader2 className="size-[18px] animate-spin" />
      ) : icon ? (
        <span className="[&>svg]:size-[18px]">{icon}</span>
      ) : null}
      {children}
      {iconRight && !loading && (
        <span className="[&>svg]:size-[18px]">{iconRight}</span>
      )}
    </ShadcnButton>
  );
}

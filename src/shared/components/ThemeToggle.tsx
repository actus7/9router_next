"use client";

import { useTheme } from "@/shared/hooks/useTheme";
import { cn } from "@/lib/utils";
import Button from "@/shared/components/Button";
import { Sun, Moon } from "lucide-react";
import { useSyncExternalStore } from "react";

type ThemeToggleVariant = 'default' | 'card';

interface ThemeToggleProps {
  className?: string;
  variant?: ThemeToggleVariant;
}

export default function ThemeToggle({ className, variant = "default" }: ThemeToggleProps) {
  const { toggleTheme, isDark } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const variants: Record<ThemeToggleVariant, string> = {
    default: cn(
      "flex items-center justify-center size-10 rounded-full",
      "text-text-muted hover:text-text-main",
      "hover:bg-surface-2 transition-colors"
    ),
    card: cn(
      "flex items-center justify-center size-11 rounded-full",
      "bg-surface/60 hover:bg-surface",
      "border border-border",
      "backdrop-blur-md shadow-sm hover:shadow-[var(--shadow-warm)]",
      "text-text-muted hover:text-brand-500",
      "transition-all group"
    ),
  };

  return (
    <Button
      variant="ghost"
      onClick={toggleTheme}
      className={cn(variants[variant], className)}
      aria-label={`Mudar para modo ${mounted && isDark ? "claro" : "escuro"}`}
      title={`Mudar para modo ${mounted && isDark ? "claro" : "escuro"}`}
    >
      {mounted && isDark ? (
        <Sun className={cn("size-[22px]", variant === "card" && "transition-transform duration-300 group-hover:rotate-12")} />
      ) : (
        <Moon className={cn("size-[22px]", variant === "card" && "transition-transform duration-300 group-hover:rotate-12")} />
      )}
    </Button>
  );
}

"use client";

import React, { useId } from "react";
import { cn } from "@/lib/utils";
import { Input as ShadcnInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle } from "lucide-react";

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  error?: string;
  hint?: string;
  icon?: React.ReactNode;
  inputClassName?: string;
}

function FormInput({
  label,
  type = "text",
  placeholder,
  value,
  onChange,
  error,
  hint,
  icon,
  disabled = false,
  required = false,
  className,
  inputClassName,
  id,
  "aria-describedby": ariaDescribedBy,
  ...props
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? `input-${generatedId}`;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const describedBy = [ariaDescribedBy, error ? errorId : undefined, hint && !error ? hintId : undefined]
    .filter(Boolean)
    .join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <Label htmlFor={inputId} className="text-sm font-medium text-text-main">
          {label}
          {required && <span aria-hidden="true" className="ml-1 text-destructive">*</span>}
        </Label>
      )}
      <div className="relative">
        {icon && (
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-text-muted [&>svg]:size-5">
            {icon}
          </div>
        )}
        <ShadcnInput
          id={inputId}
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={cn(
            "h-auto w-full py-2.5 px-3 text-sm text-text-main bg-surface-2 rounded-[10px]",
            "border border-transparent placeholder-text-muted/70",
            "focus-visible:border-brand-500/40 focus-visible:ring-2 focus-visible:ring-brand-500/30",
            "transition-all duration-150 ease-out disabled:opacity-50 disabled:cursor-not-allowed",
            // iOS zoom fix
            "text-[16px] sm:text-sm",
            icon && "pl-10",
            error && "border-destructive/40 focus-visible:ring-destructive/40 aria-invalid:border-destructive/40 aria-invalid:ring-destructive/20",
            inputClassName
          )}
          {...props}
        />
      </div>
      {error && (
        <p id={errorId} role="alert" className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="size-3.5" />
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={hintId} className="text-xs text-text-muted">{hint}</p>
      )}
    </div>
  );
}

export { FormInput };

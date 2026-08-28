"use client";

import React, { useId } from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import {
  Select as ShadcnSelect,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import { AlertCircle } from "lucide-react";
import { translate } from "@/i18n/runtime";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  label?: string;
  options?: SelectOption[];
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
  ariaLabel?: string;
}

export default function Select({
  label,
  options = [],
  value,
  onChange,
  placeholder = "Select an option",
  error,
  hint,
  disabled = false,
  required = false,
  className,
  id,
  ariaLabel,
}: SelectProps) {
  const generatedId = useId();
  const selectId = id || generatedId;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <Label htmlFor={selectId} className="text-sm font-medium text-text-main">
          {label}
          {required && <span className="ml-1 text-destructive">*</span>}
        </Label>
      )}
      <ShadcnSelect value={value} onValueChange={onChange ? (val) => onChange(val ?? "") : undefined} disabled={disabled} items={options}>
        <SelectTrigger
          id={selectId}
          aria-label={ariaLabel || label}
          aria-invalid={!!error}
          aria-required={required}
          className={cn(
            "w-full py-2.5 px-3 pr-10 text-sm text-text-main",
            "bg-surface-2 border border-transparent rounded-[10px]",
            "focus-visible:border-brand-500/40 focus-visible:ring-2 focus-visible:ring-brand-500/30",
            "transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed",
            "text-[16px] sm:text-sm",
            error && "border-red-500/40 focus-visible:ring-red-500/40 aria-invalid:border-red-500/40 aria-invalid:ring-red-500/20"
          )}
        >
          <SelectValue placeholder={translate(placeholder) || placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </ShadcnSelect>
      {error && (
        <p className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="size-3.5" />
          {error}
        </p>
      )}
      {hint && !error && (
        <p className="text-xs text-text-muted">{hint}</p>
      )}
    </div>
  );
}

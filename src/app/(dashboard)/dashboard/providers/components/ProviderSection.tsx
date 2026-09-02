"use client";

import { Button } from "@/components/ui/button";
import { Play } from "lucide-react";
import { translate } from "@/i18n/runtime";

interface ProviderSectionProps {
  title: React.ReactNode;
  description?: string;
  testMode: string;
  testLabel: string;
  testAriaLabel: string;
  testingMode: string | null;
  onTest: (mode: string) => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function ProviderSection({
  title,
  description,
  testMode,
  testLabel,
  testAriaLabel,
  testingMode,
  onTest,
  children,
  footer,
}: ProviderSectionProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
            {title}
          </h2>
          {description && (
            <p className="text-xs text-text-muted">{description}</p>
          )}
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Button
            variant="outline"
            onClick={() => onTest(testMode)}
            disabled={!!testingMode}
            className={testingMode === testMode ? "animate-pulse" : ""}
            title={translate(testLabel) || testLabel}
            aria-label={translate(testAriaLabel) || testAriaLabel}
          >
            <span
              className={`text-[14px]${testingMode === testMode ? " animate-spin" : ""}`}
            >
              <Play className="size-3.5" />
            </span>
            {testingMode === testMode ? translate("Testing...") : translate("Test All")}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
        {children}
      </div>
      {footer}
    </div>
  );
}

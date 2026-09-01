"use client";

import { Alert } from "@/components/ui/alert";
import { Info, TriangleAlert } from "lucide-react";
import type { ProviderInfo } from "../types";

interface ProviderAlertsProps {
  providerInfo: ProviderInfo;
}

export default function ProviderAlerts({ providerInfo }: ProviderAlertsProps) {
  return (
    <>
      {providerInfo.deprecated && (
        <div className="flex items-start gap-3 rounded-xl border border-warning-border bg-warning px-4 py-3">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <p className="text-xs text-destructive-foreground dark:text-warning-foreground leading-relaxed">{providerInfo.deprecationNotice}</p>
        </div>
      )}

      {providerInfo.notice?.text && !providerInfo.deprecated && (
        <Alert className="border-info-border bg-info/[0.08] px-4 py-3 text-info-foreground dark:text-info-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-info-foreground dark:text-info-foreground sm:mt-0" />
          <p className="min-w-0 flex-1 text-sm leading-relaxed text-info-foreground dark:text-info-foreground">{providerInfo.notice.text}</p>
          {providerInfo.notice.apiKeyUrl && (
            <a
              href={providerInfo.notice.apiKeyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 justify-center rounded-lg bg-info px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-info"
            >
              Get API Key →
            </a>
          )}
        </Alert>
      )}
    </>
  );
}

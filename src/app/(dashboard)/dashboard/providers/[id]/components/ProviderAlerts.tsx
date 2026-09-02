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
        <div className="flex items-start gap-3 rounded-xl border border-warning-border bg-warning px-4 py-3 text-warning-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <p className="text-xs leading-relaxed">{providerInfo.deprecationNotice}</p>
        </div>
      )}

      {providerInfo.notice?.text && !providerInfo.deprecated && (
        <Alert className="border-info-border bg-info/[0.08] px-4 py-3 text-info">
          <Info className="mt-0.5 size-4 shrink-0 sm:mt-0" />
          <p className="min-w-0 flex-1 text-sm leading-relaxed">{providerInfo.notice.text}</p>
          {providerInfo.notice.apiKeyUrl && (
            <a
              href={providerInfo.notice.apiKeyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 justify-center rounded-lg bg-info/10 px-3 py-1.5 text-xs font-medium text-info transition-colors hover:bg-info/20"
            >
              Get API Key →
            </a>
          )}
        </Alert>
      )}
    </>
  );
}

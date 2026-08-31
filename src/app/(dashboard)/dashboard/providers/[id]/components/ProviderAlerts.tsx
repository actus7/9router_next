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
        <div className="flex items-start gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <p className="text-xs text-red-600 dark:text-yellow-400 leading-relaxed">{providerInfo.deprecationNotice}</p>
        </div>
      )}

      {providerInfo.notice?.text && !providerInfo.deprecated && (
        <Alert className="border-blue-500/25 bg-blue-500/[0.08] px-4 py-3 text-blue-700 dark:text-blue-300">
          <Info className="mt-0.5 size-4 shrink-0 text-blue-600 dark:text-blue-400 sm:mt-0" />
          <p className="min-w-0 flex-1 text-sm leading-relaxed text-blue-700 dark:text-blue-300">{providerInfo.notice.text}</p>
          {providerInfo.notice.apiKeyUrl && (
            <a
              href={providerInfo.notice.apiKeyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 justify-center rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-600"
            >
              Get API Key →
            </a>
          )}
        </Alert>
      )}
    </>
  );
}

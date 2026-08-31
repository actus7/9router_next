"use client";

import { Button } from "@/shared/components";
import { Plus, Puzzle } from "lucide-react";
import { translate } from "@/i18n/runtime";
import type { ProviderInfo, ProviderStats } from "../types";
import { ApiKeyProviderCard } from "./ApiKeyProviderCard";

interface CustomProvidersSectionProps {
  compatibleProviders: (ProviderInfo & { apiType?: string })[];
  anthropicCompatibleProviders: ProviderInfo[];
  getStats: (id: string, auth: string | string[]) => ProviderStats;
  onToggle: (providerId: string, authType: string, active: boolean) => void;
  onAddOpenAI: () => void;
  onAddAnthropic: () => void;
}

export function CustomProvidersSection({
  compatibleProviders,
  anthropicCompatibleProviders,
  getStats,
  onToggle,
  onAddOpenAI,
  onAddAnthropic,
}: CustomProvidersSectionProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
          {translate("Custom Providers (OpenAI/Anthropic Compatible)")}{" "}
        </h2>
        <div className="grid grid-cols-1 gap-2 sm:flex sm:w-auto">
          <Button
            icon={<Plus className="size-4" />}
            onClick={onAddAnthropic}
            className="w-full sm:w-auto"
          >
            {translate("Add Anthropic Compatible")}
          </Button>
          <Button
            variant="outline"
            icon={<Plus className="size-4" />}
            onClick={onAddOpenAI}
            className="w-full sm:w-auto"
          >
            {translate("Add OpenAI Compatible")}
          </Button>
        </div>
      </div>
      {compatibleProviders.length === 0 &&
      anthropicCompatibleProviders.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-2 border border-dashed border-border rounded-xl text-text-muted text-sm">
          <Puzzle className="size-5" />
          <span>{translate("No custom providers — use the buttons above to add OpenAI/Anthropic compatible endpoints")}</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {[...compatibleProviders, ...anthropicCompatibleProviders].map(
            (info) => (
              <ApiKeyProviderCard
                key={info.id}
                providerId={info.id}
                provider={info}
                stats={getStats(info.id, "apikey")}
                onToggle={(active) =>
                  onToggle(info.id, "apikey", active)
                }
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

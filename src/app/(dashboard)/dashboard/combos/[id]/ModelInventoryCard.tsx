"use client";

import { RefreshCw, Sparkles } from "lucide-react";
import { Button, Card } from "@/shared/components";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";
import type { RoutingTierOrDefault, SmartModelProfile } from "@/shared/llm-catalog";

export function ModelInventoryCard({
  profiles, profileSummary, tierLabels,
  onRefresh, loadingProfiles, onSuggest, suggesting,
}: {
  profiles: SmartModelProfile[];
  profileSummary: { total: number; llm: number; enriched: number };
  tierLabels: Record<RoutingTierOrDefault, string>;
  onRefresh: () => void;
  loadingProfiles: boolean;
  onSuggest: () => void;
  suggesting: boolean;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-text-main">{translate("All available models")}</h2>
            <p className="mt-1 text-sm text-text-muted">{profileSummary.total} {translate("active models from your connected providers")} · {profileSummary.llm} {translate("are chat/text")} · {profileSummary.enriched} {translate("have had quality assessed (by AI or manually).")}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" onClick={onRefresh} loading={loadingProfiles}><RefreshCw data-icon="inline-start" /> {translate("Reload list")}</Button>
            <Button onClick={onSuggest} loading={suggesting}><Sparkles data-icon="inline-start" /> {translate("Assess quality with AI")}</Button>
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="hidden grid-cols-[minmax(0,1.5fr)_110px_90px_100px] gap-3 bg-muted px-3 py-2 text-xs font-medium text-text-muted md:grid">
            <span>{translate("Model")}</span><span>{translate("Tier")}</span><span>{translate("Quality")}</span><span>{translate("Source")}</span>
          </div>
          <ul className="max-h-[480px] divide-y divide-border overflow-y-auto">
            {profiles.slice(0, 250).map((profile) => (
              <li key={profile.modelKey} className="grid gap-2 px-3 py-3 text-sm md:grid-cols-[minmax(0,1.5fr)_110px_90px_100px] md:items-center md:gap-3">
                <div className="min-w-0"><code className="block truncate font-mono text-xs text-text-main">{profile.modelKey}</code><span className="mt-0.5 block text-[11px] text-text-muted">{profile.capabilities.serviceKinds.join(", ")}</span></div>
                <span className="text-xs text-text-muted">{tierLabels[profile.recommendedTier]}</span>
                <span className="text-xs text-text-muted">{Math.round(profile.quality * 100)}%</span>
                <span className={cn("w-fit rounded-full px-2 py-0.5 text-[11px]", profile.source === "deterministic" ? "bg-muted text-text-muted" : "bg-primary/10 text-primary")}>{profile.source}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

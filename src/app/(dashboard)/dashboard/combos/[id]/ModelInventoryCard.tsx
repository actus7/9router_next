"use client";

import { useMemo, useState } from "react";

import { RefreshCw } from "lucide-react";
import { Card } from "@/shared/components";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";
import type { RoutingTierOrDefault, SmartModelProfile } from "@/shared/llm-catalog";

export function ModelInventoryCard({
  profiles, profileSummary, tierLabels,
  onRefresh, loadingProfiles,
}: {
  profiles: SmartModelProfile[];
  profileSummary: { total: number; llm: number; llmEnriched: number };
  tierLabels: Record<RoutingTierOrDefault, string>;
  onRefresh: () => void;
  loadingProfiles: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Chat routing drops every non-llm profile before ranking, so on this screen
  // their Tier and Quality columns describe nothing.
  const [chatOnly, setChatOnly] = useState(true);
  const visible = useMemo(
    () => (chatOnly ? profiles.filter((p) => p.capabilities.serviceKinds.includes("llm")) : profiles),
    [profiles, chatOnly],
  );

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-text-main">{translate("All available models")}</h2>
            <p className="mt-1 text-sm text-text-muted">{profileSummary.llm} {translate("chat models eligible for this combo")} · {profileSummary.llmEnriched} {translate("with quality assessed (by AI or manually)")} · {profileSummary.total} {translate("active in total — image, audio and embeddings never route chat.")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
              {open ? translate("Hide list") : translate("Show list")}
            </Button>
            {open && (
              <>
                <Button variant="outline" size="sm" onClick={() => setChatOnly((value) => !value)}>
                  {chatOnly ? translate("Show all kinds") : translate("Only chat models")}
                </Button>
                <Button variant="outline" size="sm" onClick={onRefresh} loading={loadingProfiles}><RefreshCw data-icon="inline-start" /> {translate("Reload list")}</Button>
              </>
            )}
          </div>
        </div>
        {open && (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="hidden grid-cols-[minmax(0,1.5fr)_110px_90px_100px] gap-3 bg-muted px-3 py-2 text-xs font-medium text-text-muted md:grid">
            <span>{translate("Model")}</span><span>{translate("Tier")}</span><span>{translate("Quality")}</span><span>{translate("Source")}</span>
          </div>
          <ul className="max-h-[480px] divide-y divide-border overflow-y-auto">
            {visible.slice(0, 250).map((profile) => (
              <li key={profile.modelKey} className="grid gap-2 px-3 py-3 text-sm md:grid-cols-[minmax(0,1.5fr)_110px_90px_100px] md:items-center md:gap-3">
                <div className="min-w-0"><code className="block truncate font-mono text-xs text-text-main">{profile.modelKey}</code><span className="mt-0.5 block text-[11px] text-text-muted">{profile.capabilities.serviceKinds.join(", ")}</span></div>
                <span className="text-xs text-text-muted">{tierLabels[profile.recommendedTier]}</span>
                <span className="text-xs text-text-muted">{Math.round(profile.quality * 100)}%</span>
                <span className={cn("w-fit rounded-full px-2 py-0.5 text-[11px]", profile.source === "deterministic" ? "bg-muted text-text-muted" : "bg-primary/10 text-primary")}>{profile.source}</span>
              </li>
            ))}
          </ul>
        </div>
        )}
      </div>
    </Card>
  );
}

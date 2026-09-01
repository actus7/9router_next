"use client";

import Link from "next/link";
import { Card } from "@/shared/components";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { PauseCircle } from "lucide-react";
import { translate } from "@/i18n/runtime";
import type { ProviderInfo, ProviderStats, Availability } from "../types";
import { getStatusDisplay } from "../utils/providerHelpers";
import { AvailabilityBadge } from "./AvailabilityBadge";

interface ProviderCardProps {
  providerId: string;
  provider: ProviderInfo;
  stats: ProviderStats;
  onToggle: (active: boolean) => void;
  availability?: Availability;
}

export function ProviderCard({ providerId, provider, stats, onToggle, availability }: ProviderCardProps) {
  const { connected, error, errorCode, errorTime, allDisabled } = stats;
  const isNoAuth = !!provider.noAuth;

  return (
    <Link href={`/dashboard/providers/${providerId}`} className="group min-w-0">
      <Card
        padding="xs"
        className={`h-full hover:bg-surface-2/30 transition-colors cursor-pointer ${allDisabled ? "opacity-50" : ""}`}
      >
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="size-8 shrink-0 rounded-lg flex items-center justify-center"
              style={{
                backgroundColor: `${(provider.color?.length ?? 0) > 7 ? provider.color : provider.color + "15"}`,
              }}
            >
              <ProviderIcon
                src={`/providers/${provider.id}.png`}
                alt={provider.name}
                size={30}
                className="object-contain rounded-lg max-w-[32px] max-h-[32px]"
                fallbackText={
                  provider.textIcon || provider.id.slice(0, 2).toUpperCase()
                }
                fallbackColor={provider.color}
              />
            </div>
            <div className="min-w-0">
              <h3 className="truncate font-semibold">{provider.name}</h3>
              <div className="flex min-w-0 items-center gap-1.5 text-xs flex-wrap">
                {allDisabled ? (
                  <Badge variant="default" >
                    <span className="flex items-center gap-1">
                      <PauseCircle className="size-3" />
                      {translate("Disabled")}
                    </span>
                  </Badge>
                ) : isNoAuth ? (
                  <Badge variant="default" className="bg-success text-success-foreground dark:text-success-foreground">{translate("Ready")}</Badge>
                ) : (
                  <>
                    {getStatusDisplay(connected, error, errorCode)}
                    {errorTime && (
                      <span className="text-text-muted">{errorTime}</span>
                    )}
                  </>
                )}
                {availability && <AvailabilityBadge availability={availability} />}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {stats.total > 0 && (
              <div
                className="opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggle(!allDisabled ? false : true);
                }}
              >
                <Switch
                  checked={!allDisabled}
                  onCheckedChange={() => {}}
                  title={allDisabled ? translate("Enable provider") ?? undefined : translate("Disable provider") ?? undefined}
                />
              </div>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

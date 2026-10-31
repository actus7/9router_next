"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Globe, KeyRound, Sparkles, UserRound } from "lucide-react";
import { translate } from "@/i18n/runtime";
import ModelAvailabilityBadge from "./ModelAvailabilityBadge";
import type { AvailabilityFilter } from "../types";

interface AvailabilityFilterBarProps {
  availabilityFilter: AvailabilityFilter;
  onFilterChange: (filter: AvailabilityFilter) => void;
}

export function AvailabilityFilterBar({
  availabilityFilter,
  onFilterChange,
}: AvailabilityFilterBarProps) {
  const variantFor = (filter: AvailabilityFilter) => (availabilityFilter === filter ? "default" : "outline");
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={translate("Provider availability filters") || "Provider availability filters"}>
        <Button variant={variantFor("all")} size="sm" onClick={() => onFilterChange("all")}>
          {translate("All providers") || "All providers"}
        </Button>
        <Button variant={variantFor("free")} size="sm" onClick={() => onFilterChange("free")}>
          <Sparkles className="size-3.5" /> {translate("Free available") || "Free available"}
        </Button>
        <Button variant={variantFor("connected")} size="sm" onClick={() => onFilterChange("connected")}>
          {translate("Connected") || "Connected"}
        </Button>
        <ModelAvailabilityBadge />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
        <span className="inline-flex items-center gap-1"><KeyRound className="size-3.5" /> {translate("API Key") || "API Key"}</span>
        <span className="inline-flex items-center gap-1"><UserRound className="size-3.5" /> {translate("Account connection") || "Account connection"}</span>
        <span className="inline-flex items-center gap-1"><Sparkles className="size-3.5 text-success" /> {translate("Free access or recurring free tier") || "Free access or recurring free tier"}</span>
        <Link href="/dashboard/web-providers" className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
          <Globe className="size-3.5" /> {translate("Web Session Providers") || "Web Session Providers"}
        </Link>
      </div>
    </div>
  );
}

"use client";

import { Button } from "@/components/ui/button";
import { KeyRound, Sparkles, UserRound } from "lucide-react";
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
  return (
    <section className="rounded-xl border border-border bg-surface-1 px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-2xl">
          <h2 className="text-base font-semibold text-text">{translate("Browse by access and availability") || "Browse by access and availability"}</h2>
          <p className="mt-1 text-sm text-text-muted">
            {translate("Connection sections show the setup method. Free availability is a label, so it never hides whether you need an account or API key.") || "Connection sections show the setup method. Free availability is a label, so it never hides whether you need an account or API key."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2" aria-label={translate("Provider availability filters") || "Provider availability filters"}>
          <ModelAvailabilityBadge />
          <Button variant={availabilityFilter === "all" ? "default" : "outline"} size="sm" onClick={() => onFilterChange("all")}>
            {translate("All providers") || "All providers"}
          </Button>
          <Button variant={availabilityFilter === "free" ? "default" : "outline"} size="sm" onClick={() => onFilterChange("free")}>
            <Sparkles className="size-3.5" /> {translate("Free available") || "Free available"}
          </Button>
          <Button variant={availabilityFilter === "connected" ? "default" : "outline"} size="sm" onClick={() => onFilterChange("connected")}>
            {translate("Connected") || "Connected"}
          </Button>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-3 text-xs text-text-muted">
        <span className="inline-flex items-center gap-1.5"><KeyRound className="size-3.5" /> {translate("API Key") || "API Key"}</span>
        <span className="inline-flex items-center gap-1.5"><UserRound className="size-3.5" /> {translate("Account connection") || "Account connection"}</span>
        <span className="inline-flex items-center gap-1.5"><Sparkles className="size-3.5 text-success" /> {translate("Free access or recurring free tier") || "Free access or recurring free tier"}</span>
      </div>
    </section>
  );
}

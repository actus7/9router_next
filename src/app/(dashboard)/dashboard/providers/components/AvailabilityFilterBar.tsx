"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Cpu, FolderOpen, Globe, KeyRound, MessageSquare, Plus, Sparkles, UserRound, X } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { AI_PROVIDERS, MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import { KIND_ICON_MAP } from "@/shared/components/sidebarData";
import { providerKinds } from "../hooks/computeProviderEntries";
import ModelAvailabilityBadge from "./ModelAvailabilityBadge";
import type { AvailabilityFilter, ProviderInfo } from "../types";
import { TYPESAFE_SETTINGS_HREF } from "../typesafeProvider";

interface KindChip { id: string; label: string; Icon: typeof MessageSquare }

// Only kinds some visible provider serves get a chip.
const servedKinds = new Set(
  (Object.values(AI_PROVIDERS) as ProviderInfo[]).filter((p) => !p.hidden).flatMap(providerKinds),
);
const KIND_CHIPS: KindChip[] = [
  { id: "llm", label: "Chat", Icon: MessageSquare },
  // Typed-decision models (Jev…): not a media kind, so it has no MEDIA_PROVIDER_KINDS entry.
  { id: "systemOne", label: "System One", Icon: Cpu },
  ...MEDIA_PROVIDER_KINDS.map((k) => ({ id: k.id, label: k.label, Icon: KIND_ICON_MAP[k.icon] ?? FolderOpen })),
].filter((chip) => servedKinds.has(chip.id));

interface AvailabilityFilterBarProps {
  availabilityFilter: AvailabilityFilter;
  onFilterChange: (filter: AvailabilityFilter) => void;
  /** Kind chips render only when the page passes a handler (web sessions are chat-only). */
  kindFilter?: string[];
  onToggleKind?: (kind: string) => void;
  onClearKinds?: () => void;
}

export function AvailabilityFilterBar({
  availabilityFilter,
  onFilterChange,
  kindFilter = [],
  onToggleKind,
  onClearKinds,
}: AvailabilityFilterBarProps) {
  const variantFor = (filter: AvailabilityFilter) => (availabilityFilter === filter ? "default" : "outline");
  const hasWebKind = kindFilter.includes("webSearch") || kindFilter.includes("webFetch");
  return (
    <div className="flex flex-col gap-3">
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
      {onToggleKind && <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={translate("Media Providers") || "Media Providers"}>
        {KIND_CHIPS.map(({ id, label, Icon }) => {
          const isSelected = kindFilter.includes(id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onToggleKind(id)}
              className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${isSelected ? "border-primary bg-primary/15 text-primary" : "border-border text-text-muted hover:border-primary/50 hover:text-text"}`}
            >
              <Icon className="size-3.5" /> {translate(label) || label}
            </button>
          );
        })}
        {kindFilter.length > 0 && (
          <button type="button" onClick={onClearKinds} className="inline-flex h-7 items-center gap-1 px-2 text-xs text-text-muted hover:text-text">
            <X className="size-3.5" /> {translate("Clear") || "Clear"}
          </button>
        )}
        {kindFilter.includes("embedding") && (
          <Link href="/dashboard/media-providers/embedding" className="ml-2 inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline">
            <Plus className="size-3.5" /> {translate("Add Custom Embedding") || "Add Custom Embedding"}
          </Link>
        )}
        {kindFilter.includes("systemOne") && (
          <Link href={TYPESAFE_SETTINGS_HREF} className="ml-2 inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline">
            <Cpu className="size-3.5" /> {translate("Decision engine") || "Decision engine"}
          </Link>
        )}
        {hasWebKind && (
          <Link href="/dashboard/media-providers/web" className="ml-2 inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline">
            <Globe className="size-3.5" /> {translate("Web Fetch & Search") || "Web Fetch & Search"}
          </Link>
        )}
      </div>}
    </div>
  );
}

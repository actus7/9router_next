"use client";

import { CAPACITY_META, type CapacityKey } from "@/shared/constants/models";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Eye, Brain } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  Eye,
  Brain,
};

interface CapacityBadgesProps {
  caps?: Record<string, boolean> | null;
  className?: string;
  colorOverride?: string;
  size?: number;
}

// Render small icon badges for a model's capabilities (only those set true).
// colorOverride: force a single color class for all badges (default: per-cap color).
// size: icon size in px (default 16).
export default function CapacityBadges({ caps, className = "", colorOverride, size = 16 }: CapacityBadgesProps) {
  if (!caps) return null;
  const active = Object.keys(CAPACITY_META).filter((k) => caps[k]) as CapacityKey[];
  if (active.length === 0) return null;

  return (
    <TooltipProvider>
      <span className={`inline-flex items-center gap-0.5 ${className}`}>
        {active.map((k) => {
          const IconComp = ICON_MAP[CAPACITY_META[k].icon];
          return (
            <Tooltip key={k}>
              <TooltipTrigger render={<span className="inline-flex" />}>
                {IconComp ? (
                  <IconComp
                    className={`cursor-help ${colorOverride || CAPACITY_META[k].color}`}
                    size={size}
                  />
                ) : (
                  <span className={`cursor-help ${colorOverride || CAPACITY_META[k].color}`}>{CAPACITY_META[k].icon}</span>
                )}
              </TooltipTrigger>
              <TooltipContent>{`${CAPACITY_META[k].label} — ${CAPACITY_META[k].desc}`}</TooltipContent>
            </Tooltip>
          );
        })}
      </span>
    </TooltipProvider>
  );
}

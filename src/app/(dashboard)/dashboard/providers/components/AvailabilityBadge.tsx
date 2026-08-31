"use client";

import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Availability } from "../types";

export function AvailabilityBadge({ availability }: { availability: Availability }) {
  return (
    <Badge variant="default" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
      <Sparkles className="mr-1 size-3" />
      {availability === "free" ? "Free access" : "Free tier"}
    </Badge>
  );
}

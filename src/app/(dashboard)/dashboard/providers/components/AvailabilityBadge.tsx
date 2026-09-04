"use client";

import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Availability } from "../types";

export function AvailabilityBadge({ availability }: { availability: Availability }) {
  return (
    <Badge variant="success">
      <Sparkles className="mr-1 size-3" />
      {availability === "free" ? "Free access" : "Free tier"}
    </Badge>
  );
}

"use client";

import { Card } from "@/shared/components";
import { Contrast } from "lucide-react";
import { translate } from "@/i18n/runtime";
import AccentColorPicker from "@/shared/components/AccentColorPicker";

export default function AccentColorCard() {
  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Contrast className="size-5" />
        </div>
        <div>
          <h3 className="text-base sm:text-lg font-semibold">{translate("Accent Color")}</h3>
          <p className="text-xs sm:text-sm text-text-muted">{translate("Choose the highlight color used across the dashboard")}</p>
        </div>
      </div>
      <AccentColorPicker />
    </Card>
  );
}

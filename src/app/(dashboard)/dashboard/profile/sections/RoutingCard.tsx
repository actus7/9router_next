"use client";

import { Card, Input } from "@/shared/components";
import { Switch } from "@/components/ui/switch";
import { Route } from "lucide-react";
import { translate } from "@/i18n/runtime";
import type { Settings } from "../types";

interface RoutingCardProps {
  settings: Settings;
  loading: boolean;
  updateFallbackStrategy: (strategy: string) => Promise<void>;
  updateComboStrategy: (strategy: string) => Promise<void>;
  updateStickyLimit: (limit: string) => Promise<void>;
  updateComboStickyLimit: (limit: string) => Promise<void>;
}

export default function RoutingCard({
  settings, loading,
  updateFallbackStrategy, updateComboStrategy, updateStickyLimit, updateComboStickyLimit,
}: RoutingCardProps) {
  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500 shrink-0">
          <Route className="size-5" />
        </div>
        <h3 className="text-base sm:text-lg font-semibold">{translate("Routing Strategy")}</h3>
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex items-start sm:items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm sm:text-base">Round Robin</p>
            <p className="text-xs sm:text-sm text-text-muted">
              {translate("Cycle through accounts to distribute load")}
            </p>
          </div>
          <Switch
            checked={settings.fallbackStrategy === "round-robin"}
            onCheckedChange={() => updateFallbackStrategy(settings.fallbackStrategy === "round-robin" ? "fill-first" : "round-robin")}
            disabled={loading}
          />
        </div>

        {/* Sticky Round Robin Limit */}
        {settings.fallbackStrategy === "round-robin" && (
          <div className="flex items-start sm:items-center justify-between gap-4 pt-2 border-t border-border/50">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm sm:text-base">{translate("Sticky Limit")}</p>
              <p className="text-xs sm:text-sm text-text-muted">
                {translate("Calls per account before switching")}
              </p>
            </div>
            <Input
              type="number"
              min="1"
              max="10"
              value={settings.stickyRoundRobinLimit || 3}
              onChange={(e) => updateStickyLimit(e.target.value)}
              disabled={loading}
              className="w-16 sm:w-20 text-center shrink-0"
            />
          </div>
        )}

        {/* Combo Round Robin */}
        <div className="flex items-start sm:items-center justify-between gap-4 pt-4 border-t border-border/50">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm sm:text-base">{translate("Combo Round Robin")}</p>
            <p className="text-xs sm:text-sm text-text-muted">
              {translate("Cycle through providers in combos instead of always starting with first")}
            </p>
          </div>
          <Switch
            checked={settings.comboStrategy === "round-robin"}
            onCheckedChange={() => updateComboStrategy(settings.comboStrategy === "round-robin" ? "fallback" : "round-robin")}
            disabled={loading}
          />
        </div>

        {/* Combo Sticky Round Robin Limit */}
        {settings.comboStrategy === "round-robin" && (
          <div className="flex items-center justify-between pt-2 border-t border-border/50">
            <div>
              <p className="font-medium">{translate("Combo Sticky Limit")}</p>
              <p className="text-sm text-text-muted">
                {translate("Calls per combo model before switching")}
              </p>
            </div>
            <Input
              type="number"
              min="1"
              max="100"
              value={settings.comboStickyRoundRobinLimit || 1}
              onChange={(e) => updateComboStickyLimit(e.target.value)}
              disabled={loading}
              className="w-20 text-center"
            />
          </div>
        )}

        <p className="text-xs text-text-muted italic pt-2 border-t border-border/50">
          {settings.fallbackStrategy === "round-robin"
            ? `${translate("Currently distributing requests across all available accounts with") || "Currently distributing requests across all available accounts with"} ${settings.stickyRoundRobinLimit || 3} ${translate("calls per account.") || "calls per account."}`
            : translate("Currently using accounts in priority order (Fill First).") || "Currently using accounts in priority order (Fill First)."}
          {settings.comboStrategy === "round-robin"
            ? ` ${translate("Combos rotate after") || "Combos rotate after"} ${settings.comboStickyRoundRobinLimit || 1} ${translate("calls per model.") || "calls per model."}`
            : ` ${translate("Combos always start with their first model.") || "Combos always start with their first model."}`}
        </p>
      </div>
    </Card>
  );
}

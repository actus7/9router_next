"use client";

import { useState } from "react";
import Card from "@/shared/components/Card";
import { FormInput as Input } from "@/shared/components/FormInput";
import { Switch } from "@/components/ui/switch";
import { Route } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { FREE_DEFAULT_MODEL_KEY } from "@/shared/constants/freeDefault";
import { parseLimit } from "../hooks/useProfileSettings";
import type { Settings } from "../types";

interface RoutingCardProps {
  settings: Settings;
  loading: boolean;
  updateFallbackStrategy: (strategy: string) => Promise<void>;
  updateComboStrategy: (strategy: string) => Promise<void>;
  updateStickyLimit: (limit: string) => Promise<void>;
  updateComboStickyLimit: (limit: string) => Promise<void>;
  updateFreeFallbackEnabled: (enabled: boolean) => Promise<void>;
  saveError: string | null;
}

interface LimitFieldProps {
  label: string;
  value: number;
  max: number;
  disabled: boolean;
  onCommit: (raw: string) => Promise<void>;
}

/**
 * Keeps what is being typed locally and commits on blur, so an empty or
 * out-of-range entry is never sent and does not snap back while typing.
 */
function LimitField({ label, value, max, disabled, onCommit }: LimitFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && parseLimit(draft, max) === null;

  const commit = async () => {
    if (draft === null) return;
    const next = parseLimit(draft, max);
    if (next !== null && next !== value) await onCommit(String(next));
    setDraft(null);
  };

  return (
    <Input
      type="number"
      min="1"
      max={max}
      aria-label={label}
      value={draft ?? value}
      error={invalid ? `${translate("Enter a whole number from 1 to") || "Enter a whole number from 1 to"} ${max}` : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      disabled={disabled}
      className="w-16 sm:w-20 text-center shrink-0"
    />
  );
}

export default function RoutingCard({
  settings, loading,
  updateFallbackStrategy, updateComboStrategy, updateStickyLimit, updateComboStickyLimit,
  updateFreeFallbackEnabled, saveError,
}: RoutingCardProps) {
  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-info text-info-foreground shrink-0">
          <Route className="size-5" />
        </div>
        <h2 className="text-base sm:text-lg font-semibold">{translate("Routing Strategy")}</h2>
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex items-start sm:items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm sm:text-base">{translate("Round Robin")}</p>
            <p className="text-xs sm:text-sm text-text-muted">
              {translate("Cycle through accounts to distribute load")}
            </p>
          </div>
          <Switch
            aria-label={translate("Round Robin")}
            checked={settings.fallbackStrategy === "round-robin"}
            onCheckedChange={() => updateFallbackStrategy(settings.fallbackStrategy === "round-robin" ? "fill-first" : "round-robin")}
            disabled={loading}
          />
        </div>

        {/*
          Changes WHERE the user's prompt goes: when every account of the
          requested provider is exhausted, the request is answered by a provider
          the operator never configured. Defensible as a default, but the
          operator has a right to find that out without reading the source.
        */}
        <div className="flex items-start sm:items-center justify-between gap-4 pt-2 border-t border-border/50">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm sm:text-base">{translate("Free provider fallback")}</p>
            <p className="text-xs sm:text-sm text-text-muted">
              {translate("When every account of the requested provider is exhausted, answer with the credential-free default")}
              {" "}(<code className="font-mono">{FREE_DEFAULT_MODEL_KEY}</code>){" "}
              {translate("instead of failing the request.")}
            </p>
          </div>
          <Switch
            aria-label={translate("Free provider fallback")}
            checked={settings.freeFallbackEnabled !== false}
            onCheckedChange={() => updateFreeFallbackEnabled(settings.freeFallbackEnabled === false)}
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
            <LimitField
              label={translate("Sticky Limit") || "Sticky Limit"}
              value={settings.stickyRoundRobinLimit || 3}
              max={10}
              disabled={loading}
              onCommit={updateStickyLimit}
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
            aria-label={translate("Combo Round Robin")}
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
            <LimitField
              label={translate("Combo Sticky Limit") || "Combo Sticky Limit"}
              value={settings.comboStickyRoundRobinLimit || 1}
              max={100}
              disabled={loading}
              onCommit={updateComboStickyLimit}
            />
          </div>
        )}

        {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}

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

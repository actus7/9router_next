"use client";

import { Switch } from "@/components/ui/switch";
import { Input as RawInput } from "@/components/ui/input";

interface RoundRobinToggleProps {
  providerStrategy: string | null;
  onRoundRobinToggle: (enabled: boolean) => void;
  providerStickyLimit: string;
  onStickyLimitChange: (value: string) => void;
}

export default function RoundRobinToggle({
  providerStrategy,
  onRoundRobinToggle,
  providerStickyLimit,
  onStickyLimitChange,
}: RoundRobinToggleProps) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-bg px-2.5 py-1.5">
      <span className="text-xs text-text-muted font-medium">Round Robin</span>
      <Switch
        checked={providerStrategy === "round-robin"}
        onCheckedChange={onRoundRobinToggle}
      />
      {providerStrategy === "round-robin" && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-text-muted">Sticky:</span>
          <RawInput
            type="number"
            min={1}
            value={providerStickyLimit}
            onChange={(e) => onStickyLimitChange(e.target.value)}
            placeholder="1"
            className="w-14 px-2 py-1 text-xs"
          />
        </div>
      )}
    </div>
  );
}

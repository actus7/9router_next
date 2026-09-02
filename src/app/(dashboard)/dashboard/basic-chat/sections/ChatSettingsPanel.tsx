"use client";

import { Textarea } from "@/components/ui/textarea";
import { translate } from "@/i18n/runtime";
import type { UseChatSessionsReturn } from "../hooks/useChatSessions";

interface ChatSettingsPanelProps {
  sessionsHook: UseChatSessionsReturn;
}

export default function ChatSettingsPanel({ sessionsHook }: ChatSettingsPanelProps) {
  const { showSettings, systemPrompt, setSystemPrompt, temperature, setTemperature } = sessionsHook;

  if (!showSettings) return null;

  return (
    <div className="shrink-0 border-b border-border bg-card/50 px-4 py-3">
      <div className="mx-auto max-w-3xl flex flex-col gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            {translate("System prompt") || "System prompt"}
          </label>
          <Textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder={translate("You are a helpful assistant...") || "You are a helpful assistant..."}
            rows={2}
            className="text-xs resize-none"
          />
        </div>
        <div className="flex items-center gap-4">
          <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">
            {translate("Temperature") || "Temperature"}: {temperature.toFixed(1)}
          </label>
          <input
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value))}
            className="flex-1 h-1.5 accent-primary"
          />
          <span className="text-[10px] text-muted-foreground w-8 text-right">{temperature.toFixed(1)}</span>
        </div>
      </div>
    </div>
  );
}

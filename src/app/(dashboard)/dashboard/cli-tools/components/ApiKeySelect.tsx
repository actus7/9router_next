"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

const CUSTOM_VALUE = "__custom__";

interface ApiKey {
  id: string;
  key: string;
  name?: string;
}

interface ApiKeySelectProps {
  value: string;
  onChange: (value: string) => void;
  apiKeys?: ApiKey[];
  cloudEnabled?: boolean;
  className?: string;
}

export default function ApiKeySelect({ value, onChange, apiKeys = [], cloudEnabled = false, className = "" }: ApiKeySelectProps) {
  const isCustom = !apiKeys.some((k) => k.key === value) && value !== "";
  const [mode, setMode] = useState<string>(() => {
    if (!value) return apiKeys.length > 0 ? apiKeys[0].key : CUSTOM_VALUE;
    if (apiKeys.some((k) => k.key === value)) return value;
    return CUSTOM_VALUE;
  });
  const [customInput, setCustomInput] = useState<string>(isCustom ? value : "");

  const handleSelect = (next: string) => {
    setMode(next);
    if (next === CUSTOM_VALUE) {
      setCustomInput("");
      onChange("");
    } else {
      onChange(next);
    }
  };

  const handleCustomInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setCustomInput(v);
    onChange(v);
  };

  const noKeys = apiKeys.length === 0 && mode !== CUSTOM_VALUE;

  if (noKeys && mode !== CUSTOM_VALUE) {
    return (
      <span className={`min-w-0 rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5 ${className}`}>
        {cloudEnabled ? "No API keys - Create one in Keys page" : "sk_modelhub (default)"}
      </span>
    );
  }

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <Select value={mode} onValueChange={(v) => handleSelect(v ?? "")}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {apiKeys.map((k) => (
            <SelectItem key={k.id} value={k.key}>{k.key}</SelectItem>
          ))}
          <SelectItem value={CUSTOM_VALUE}>Custom...</SelectItem>
        </SelectContent>
      </Select>
      {mode === CUSTOM_VALUE && (
        <Input
          type="text"
          value={customInput}
          onChange={handleCustomInput}
          placeholder="sk-..."
          className="w-full min-w-0 px-2 py-2 text-xs sm:py-1.5"
        />
      )}
    </div>
  );
}

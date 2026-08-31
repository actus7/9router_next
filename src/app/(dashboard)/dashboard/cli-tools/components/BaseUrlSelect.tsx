"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Button from "@/shared/components/Button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { Trash2 } from "lucide-react";

const STORAGE_KEY = "modelhub.cliToolEndpointPresets";
const CUSTOM_VALUE = "__custom__";
const SAVE_VALUE = "__save__";

const ensureV1 = (url: string): string => {
  const trimmed = (url || "").replace(/\/+$/, "");
  if (!trimmed) return "";
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
};

interface SavedPreset {
  name: string;
  baseUrl: string;
}

const readSavedPresets = (): SavedPreset[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((p: SavedPreset) => p?.name && p?.baseUrl);
  } catch {
    return [];
  }
};

const writeSavedPresets = (presets: SavedPreset[]): void => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
};

interface BuildOptionsParams {
  requiresExternalUrl: boolean;
  tunnelEnabled: boolean;
  tunnelPublicUrl: string;
  tailscaleEnabled: boolean;
  tailscaleUrl: string;
  cloudEnabled: boolean;
  cloudUrl: string;
  savedPresets: SavedPreset[];
  withV1: boolean;
}

interface Option {
  value: string;
  label: string;
  url: string;
  saved?: boolean;
}

const buildOptions = ({ requiresExternalUrl, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl, cloudEnabled, cloudUrl, savedPresets, withV1 }: BuildOptionsParams): Option[] => {
  const opts: Option[] = [];
  const wrap = (url: string) => (withV1 ? ensureV1(url) : (url || "").replace(/\/+$/, ""));
  if (!requiresExternalUrl) {
    const localUrl = wrap(`http://127.0.0.1:${UPDATER_CONFIG.appPort}`);
    opts.push({ value: "local", label: localUrl, url: localUrl });
  }
  if (tunnelEnabled && tunnelPublicUrl) {
    const u = wrap(tunnelPublicUrl);
    opts.push({ value: "tunnel", label: u, url: u });
  }
  if (tailscaleEnabled && tailscaleUrl) {
    const u = wrap(tailscaleUrl);
    opts.push({ value: "tailscale", label: u, url: u });
  }
  if (cloudEnabled && cloudUrl) {
    const u = wrap(cloudUrl);
    opts.push({ value: "cloud", label: u, url: u });
  }
  savedPresets.forEach((p) => {
    opts.push({ value: `saved:${p.name}`, label: p.baseUrl, url: p.baseUrl, saved: true });
  });
  opts.push({ value: CUSTOM_VALUE, label: "Custom URL...", url: "" });
  return opts;
};

interface BaseUrlSelectProps {
  value: string;
  onChange: (value: string) => void;
  requiresExternalUrl?: boolean;
  tunnelEnabled?: boolean;
  tunnelPublicUrl?: string;
  tailscaleEnabled?: boolean;
  tailscaleUrl?: string;
  cloudEnabled?: boolean;
  cloudUrl?: string;
  withV1?: boolean;
}

export default function BaseUrlSelect({
  value,
  onChange,
  requiresExternalUrl = false,
  tunnelEnabled = false,
  tunnelPublicUrl = "",
  tailscaleEnabled = false,
  tailscaleUrl = "",
  cloudEnabled = false,
  cloudUrl = "",
  withV1 = true,
}: BaseUrlSelectProps) {
  const [savedPresets, setSavedPresets] = useState<SavedPreset[]>([]);
  const [mode, setMode] = useState<string>("");
  const [customInput, setCustomInput] = useState<string>("");
  const initializedRef = useRef(false);

  useEffect(() => {
    setSavedPresets(readSavedPresets());
  }, []);

  const options = useMemo(
    () => buildOptions({ requiresExternalUrl, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl, cloudEnabled, cloudUrl, savedPresets, withV1 }),
    [requiresExternalUrl, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl, cloudEnabled, cloudUrl, savedPresets, withV1]
  );

  // Always default to first option (127.0.0.1) on mount, ignore persisted value
  useEffect(() => {
    if (initializedRef.current) return;
    if (options.length === 0) return;
    initializedRef.current = true;
    const first = options.find((o) => o.value !== CUSTOM_VALUE);
    if (first) {
      setMode(first.value);
      onChange(first.url);
    } else {
      setMode(CUSTOM_VALUE);
    }
  }, [options, onChange]);

  const handleSelect = (next: string) => {
    if (next === SAVE_VALUE) {
      const trimmed = (value || "").trim();
      if (!trimmed) return;
      let defaultName = trimmed;
      try { defaultName = new URL(trimmed).host; } catch {}
      const name = window.prompt("Save endpoint as:", defaultName);
      if (!name?.trim()) return;
      const updated = [...savedPresets.filter((p) => p.name !== name.trim()), { name: name.trim(), baseUrl: trimmed }]
        .sort((a, b) => a.name.localeCompare(b.name));
      setSavedPresets(updated);
      writeSavedPresets(updated);
      return;
    }
    setMode(next);
    if (next === CUSTOM_VALUE) {
      setCustomInput("");
      onChange("");
      return;
    }
    const opt = options.find((o) => o.value === next);
    if (opt) onChange(opt.url);
  };

  const handleCustomInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setCustomInput(v);
    onChange(v);
  };

  const handleDeleteSaved = () => {
    if (!mode.startsWith("saved:")) return;
    const name = mode.slice(6);
    const updated = savedPresets.filter((p) => p.name !== name);
    setSavedPresets(updated);
    writeSavedPresets(updated);
    setMode(CUSTOM_VALUE);
    setCustomInput("");
    onChange("");
  };

  const isSaved = mode.startsWith("saved:");
  const isCustom = mode === CUSTOM_VALUE;
  const canSave = isCustom && (customInput || "").trim().length > 0;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Select value={mode} onValueChange={(value) => { if (value !== null) handleSelect(value); }}>
          <SelectTrigger className="flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
            {canSave && <SelectItem value={SAVE_VALUE}>+ Save current as...</SelectItem>}
          </SelectContent>
        </Select>
        {isSaved && (
          <Button variant="ghost" size="icon-sm" type="button" onClick={handleDeleteSaved} className="text-text-muted hover:text-red-500 shrink-0" title="Delete saved endpoint">
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
      {isCustom && (
        <Input
          type="text"
          value={customInput}
          onChange={handleCustomInput}
          placeholder={withV1 ? "https://example.com/v1" : "https://example.com"}
          className="w-full min-w-0 px-2 py-2 text-xs sm:py-1.5"
        />
      )}
    </div>
  );
}

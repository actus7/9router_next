"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ACCENT_COLOR_COOKIE,
  ACCENT_COLOR_OPTIONS,
  ACCENT_SWATCH,
  isValidAccentColor,
  type AccentColorId,
} from "@/shared/constants/accentColors";
import { translate } from "@/i18n/runtime";

function getAccentFromCookie(): AccentColorId {
  if (typeof document === "undefined") return "default";
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${ACCENT_COLOR_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : "default";
  return isValidAccentColor(value) ? value : "default";
}

function applyAccentToDocument(accent: AccentColorId): void {
  const root = document.documentElement;
  if (accent === "default") {
    root.removeAttribute("data-accent");
  } else {
    root.setAttribute("data-accent", accent);
  }
}

export default function AccentColorPicker() {
  const [accent, setAccent] = useState<AccentColorId>(() => getAccentFromCookie());
  const [saving, setSaving] = useState(false);

  const handleSelect = async (next: AccentColorId) => {
    if (next === accent || saving) return;
    const previous = accent;
    setAccent(next);
    applyAccentToDocument(next);
    setSaving(true);
    try {
      const response = await fetch("/api/accent-color", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accentColor: next }),
      });
      if (!response.ok) throw new Error("Failed to save accent color");
    } catch {
      setAccent(previous);
      applyAccentToDocument(previous);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-3" data-i18n-skip="true">
      {ACCENT_COLOR_OPTIONS.map((option) => {
        const active = accent === option.id;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => handleSelect(option.id)}
            disabled={saving}
            title={translate(option.label) ?? undefined}
            aria-label={translate(option.label) ?? undefined}
            aria-pressed={active}
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full ring-offset-2 ring-offset-bg transition-transform hover:scale-105",
              active ? "ring-2 ring-text-main" : "ring-1 ring-border",
            )}
            style={{ backgroundColor: ACCENT_SWATCH[option.id] }}
          >
            {active && <Check className="size-4 text-white drop-shadow" />}
          </button>
        );
      })}
    </div>
  );
}

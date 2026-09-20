"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ACCENT_COLOR_OPTIONS,
  ACCENT_SWATCH,
  type AccentColorId,
} from "@/shared/constants/accentColors";
import { translate } from "@/i18n/runtime";

function applyAccentToDocument(accent: AccentColorId): void {
  const root = document.documentElement;
  if (accent === "default") {
    root.removeAttribute("data-accent");
  } else {
    root.setAttribute("data-accent", accent);
  }
}

// `initialAccent` vem do servidor (o mesmo cookie que o RootShell lê). Ler o
// cookie no inicializador dava "default" no SSR e o valor real na hidratação —
// o anel de selecionado renderizava na bolinha errada e pulava de lugar.
export default function AccentColorPicker({ initialAccent }: { initialAccent: AccentColorId }) {
  const [accent, setAccent] = useState<AccentColorId>(initialAccent);
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

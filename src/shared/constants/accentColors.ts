/**
 * Accent color presets, shared between server (validation) and client (UI).
 *
 * "default" = current ModelHub brand orange; no `data-accent` attribute is
 * applied and globals.css stays exactly as it is today for that case.
 */

export const ACCENT_COLOR_COOKIE = "accent-color";

export const ACCENT_COLOR_OPTIONS = [
  { id: "default", label: "Default" },
  { id: "blue", label: "Blue" },
  { id: "violet", label: "Violet" },
  { id: "emerald", label: "Emerald" },
  { id: "rose", label: "Rose" },
  { id: "teal", label: "Teal" },
] as const;

export type AccentColorId = (typeof ACCENT_COLOR_OPTIONS)[number]["id"];

const ACCENT_COLOR_IDS: readonly string[] = ACCENT_COLOR_OPTIONS.map((o) => o.id);

export function isValidAccentColor(value: unknown): value is AccentColorId {
  return typeof value === "string" && ACCENT_COLOR_IDS.includes(value);
}

/**
 * Swatch shown in the picker UI — mirrors each preset's light-mode --color-brand-500.
 * "default" has no fixed value here: it's whatever --primary the active shadcn/tweakcn
 * theme defines (see AccentColorPicker, which reads `var(--primary)` directly for it
 * instead of this map, so it always matches the real applied theme).
 */
export const ACCENT_SWATCH: Record<AccentColorId, string> = {
  default: "var(--primary)",
  blue: "#2563EB",
  violet: "#7C3AED",
  emerald: "#10B981",
  rose: "#E11D6A",
  teal: "#0D9488",
};

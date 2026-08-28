"use client";

import { useState, useSyncExternalStore } from "react";
import Button from "@/shared/components/Button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { LOCALES, LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";
import { reloadTranslations, translate } from "@/i18n/runtime";
import { Check, Globe } from "lucide-react";

function getLocaleFromCookie(): string {
  if (typeof document === "undefined") return "en";
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : "en";
  return normalizeLocale(value);
}

// Locale display names - will be translated by runtime i18n
// ponytail: flag emoji render as bare region-code text on Windows (Segoe UI Emoji has no
// color-flag glyphs), so we show an explicit code badge instead of relying on emoji fallback.
const LOCALE_NAMES: Record<string, string> = {
  "en": "English",
  "vi": "Tiếng Việt",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  "ja": "日本語",
  "pt-BR": "Português (Brasil)",
  "pt-PT": "Português (Portugal)",
  "ko": "한국어",
  "es": "Español",
  "de": "Deutsch",
  "fr": "Français",
  "he": "עברית",
  "ar": "العربية",
  "ru": "Русский",
  "pl": "Polski",
  "cs": "Čeština",
  "nl": "Nederlands",
  "tr": "Türkçe",
  "uk": "Українська",
  "tl": "Tagalog",
  "id": "Indonesia",
  "th": "ไทย",
  "km": "ខ្មែរ",
  "hi": "हिन्दी",
  "bn": "বাংলা",
  "ur": "اردو",
  "ro": "Română",
  "sv": "Svenska",
  "it": "Italiano",
  "el": "Ελληνικά",
  "hu": "Magyar",
  "fi": "Suomi",
  "da": "Dansk",
  "no": "Norsk",
  "fa": "فارسی",
};

const getLocaleInfo = (locale: string): { name: string; code: string } => ({
  name: LOCALE_NAMES[locale] || locale,
  code: locale.split("-")[0].toUpperCase(),
});

interface LanguageSwitcherProps {
  className?: string;
  isOpen?: boolean;
  onClose?: (locale?: string) => void;
  hideTrigger?: boolean;
}

export default function LanguageSwitcher({ className = "", isOpen: controlledOpen, onClose, hideTrigger = false }: LanguageSwitcherProps) {
  const cookieLocale = useSyncExternalStore(
    () => () => {},
    getLocaleFromCookie,
    () => "en",
  );
  const [selectedLocale, setSelectedLocale] = useState<string | null>(null);
  const locale = selectedLocale ?? cookieLocale;
  const [isPending, setIsPending] = useState<boolean>(false);
  const [internalOpen, setInternalOpen] = useState<boolean>(false);

  const isControlled = typeof controlledOpen === "boolean";
  const isOpen = isControlled ? controlledOpen : internalOpen;

  const handleSetLocale = async (nextLocale: string) => {
    if (nextLocale === locale || isPending) return;

    setIsPending(true);
    try {
      await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: nextLocale }),
      });
      
      // Reload translations without full page reload
      await reloadTranslations();
      setSelectedLocale(nextLocale);
      if (isControlled) {
        onClose?.(nextLocale);
      } else {
        setInternalOpen(false);
      }
    } catch (err) {
      console.error("Failed to set locale:", err);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className={className}>
      {/* Trigger button */}
      {!hideTrigger && (
        <Button
          variant="ghost"
          onClick={() => {
            if (isControlled) {
              if (isOpen) onClose?.(locale);
            } else {
              setInternalOpen((prev) => !prev);
            }
          }}
          disabled={isPending}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-text-muted hover:text-text-main hover:bg-surface/60"
          title="Idioma"
          data-i18n-skip="true"
        >
          <Globe className="size-5" />
          <span className="text-sm font-medium">{getLocaleInfo(locale).name}</span>
        </Button>
      )}

      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            if (isControlled) {
              onClose?.(locale);
            } else {
              setInternalOpen(false);
            }
          }
        }}
      >
        <DialogContent className="p-0 gap-0 overflow-hidden sm:max-w-2xl max-h-[80vh] flex flex-col" data-i18n-skip="true">
          <DialogTitle className="sr-only">{translate("Select Language")}</DialogTitle>

          {/* Modal header */}
          <div className="flex items-center justify-between p-3 border-b border-black/5 dark:border-white/5">
            <h2 className="text-lg font-semibold text-text-main">{translate("Select Language")}</h2>
          </div>

          {/* Modal body - fixed grid columns, equal sizing */}
          <div className="p-6 overflow-y-auto flex-1">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2">
              {LOCALES.map((item) => {
                const active = locale === item;
                const info = getLocaleInfo(item);
                return (
                  <Button
                    key={item}
                    variant={active ? "default" : "ghost"}
                    onClick={() => handleSetLocale(item)}
                    disabled={isPending}
                    className={`relative flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-lg px-2 py-3 text-xs font-medium ${
                      active
                        ? "bg-primary/15 text-primary ring-2 ring-primary"
                        : "text-text-main hover:bg-surface-2/50"
                    } ${isPending ? "opacity-70 cursor-wait" : ""}`}
                    title={info.name}
                  >
                    {active && (
                      <Check className="absolute right-1.5 top-1.5 size-3.5" />
                    )}
                    <span className="rounded bg-surface-2/70 px-1.5 py-0.5 text-[10px] font-bold tracking-wide">{info.code}</span>
                    {/* Fixed 2-line height so all cards are uniform */}
                    <span className="flex h-8 items-center text-center leading-tight line-clamp-2">{info.name}</span>
                  </Button>
                );
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import Button from "@/shared/components/Button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { LOCALES, LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";
import { reloadTranslations } from "@/i18n/runtime";
import { Check, Globe } from "lucide-react";

function getLocaleFromCookie(): string {
  if (typeof document === "undefined") return "en";
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : "en";
  return normalizeLocale(value);
}

// Locale display names and flags - will be translated by runtime i18n
const getLocaleInfo = (locale: string): { name: string; flag: string } => {
  const locales: Record<string, { name: string; flag: string }> = {
    "en": { name: "English", flag: "🇺🇸" },
    "vi": { name: "Tiếng Việt", flag: "🇻🇳" },
    "zh-CN": { name: "简体中文", flag: "🇨🇳" },
    "zh-TW": { name: "繁體中文", flag: "🇹🇼" },
    "ja": { name: "日本語", flag: "🇯🇵" },
    "pt-BR": { name: "Português (Brasil)", flag: "🇧🇷" },
    "pt-PT": { name: "Português (Portugal)", flag: "🇵🇹" },
    "ko": { name: "한국어", flag: "🇰🇷" },
    "es": { name: "Español", flag: "🇪🇸" },
    "de": { name: "Deutsch", flag: "🇩🇪" },
    "fr": { name: "Français", flag: "🇫🇷" },
    "he": { name: "עברית", flag: "🇮🇱" },
    "ar": { name: "العربية", flag: "🇸🇦" },
    "ru": { name: "Русский", flag: "🇷🇺" },
    "pl": { name: "Polski", flag: "🇵🇱" },
    "cs": { name: "Čeština", flag: "🇨🇿" },
    "nl": { name: "Nederlands", flag: "🇳🇱" },
    "tr": { name: "Türkçe", flag: "🇹🇷" },
    "uk": { name: "Українська", flag: "🇺🇦" },
    "tl": { name: "Tagalog", flag: "🇵🇭" },
    "id": { name: "Indonesia", flag: "🇮🇩" },
    "th": { name: "ไทย", flag: "🇹🇭" },
    "km": { name: "ខ្មែរ", flag: "🇰🇭" },
    "hi": { name: "हिन्दी", flag: "🇮🇳" },
    "bn": { name: "বাংলা", flag: "🇧🇩" },
    "ur": { name: "اردو", flag: "🇵🇰" },
    "ro": { name: "Română", flag: "🇷🇴" },
    "sv": { name: "Svenska", flag: "🇸🇪" },
    "it": { name: "Italiano", flag: "🇮🇹" },
    "el": { name: "Ελληνικά", flag: "🇬🇷" },
    "hu": { name: "Magyar", flag: "🇭🇺" },
    "fi": { name: "Suomi", flag: "🇫🇮" },
    "da": { name: "Dansk", flag: "🇩🇰" },
    "no": { name: "Norsk", flag: "🇳🇴" },
    "fa": { name: "فارسی", flag: "🇮🇷" }
  };
  return locales[locale] || { name: locale, flag: "🌐" };
};

interface LanguageSwitcherProps {
  className?: string;
  isOpen?: boolean;
  onClose?: (locale?: string) => void;
  hideTrigger?: boolean;
}

export default function LanguageSwitcher({ className = "", isOpen: controlledOpen, onClose, hideTrigger = false }: LanguageSwitcherProps) {
  const [locale, setLocale] = useState<string>("en");
  const [isPending, setIsPending] = useState<boolean>(false);
  const [internalOpen, setInternalOpen] = useState<boolean>(false);

  const isControlled = typeof controlledOpen === "boolean";
  const isOpen = isControlled ? controlledOpen : internalOpen;

  useEffect(() => {
    setLocale(getLocaleFromCookie());
  }, []);

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
      setLocale(nextLocale);
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
          title="Language"
          data-i18n-skip="true"
        >
          <Globe className="size-5" />
          <span className="text-sm font-medium">{getLocaleInfo(locale).name}</span>
          <span className="text-lg">{getLocaleInfo(locale).flag}</span>
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
          <DialogTitle className="sr-only">Select Language</DialogTitle>

          {/* Modal header */}
          <div className="flex items-center justify-between p-3 border-b border-black/5 dark:border-white/5">
            <h2 className="text-lg font-semibold text-text-main">Select Language</h2>
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
                    className={`flex flex-col items-center justify-start gap-1 px-2 py-3 rounded-lg text-xs font-medium w-full ${
                      active
                        ? "bg-primary/15 text-primary ring-2 ring-primary"
                        : "text-text-main hover:bg-surface-2/50"
                    } ${isPending ? "opacity-70 cursor-wait" : ""}`}
                    title={info.name}
                  >
                    <span className="text-2xl">{info.flag}</span>
                    {/* Fixed 2-line height so all cards are uniform */}
                    <span className="text-center leading-tight line-clamp-2 h-8 flex items-center">{info.name}</span>
                    {active && (
                      <Check className="size-4" />
                    )}
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

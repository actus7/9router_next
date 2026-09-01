"use client";

import { Button } from "@/components/ui/button";
import { LOCALES } from "@/i18n/config";
import { Check } from "lucide-react";

const LOCALE_NAMES: Record<string, string> = {
  "en": "English", "vi": "Tiếng Việt", "zh-CN": "简体中文", "zh-TW": "繁體中文",
  "ja": "日本語", "pt-BR": "Português (Brasil)", "pt-PT": "Português (Portugal)",
  "ko": "한국어", "es": "Español", "de": "Deutsch", "fr": "Français", "he": "עברית",
  "ar": "العربية", "ru": "Русский", "pl": "Polski", "cs": "Čeština", "nl": "Nederlands",
  "tr": "Türkçe", "uk": "Українська", "tl": "Tagalog", "id": "Indonesia", "th": "ไทย",
  "km": "ខ្មែរ", "hi": "हिन्दी", "bn": "বাংলা", "ur": "اردو", "ro": "Română",
  "sv": "Svenska", "it": "Italiano", "el": "Ελληνικά", "hu": "Magyar", "fi": "Suomi",
  "da": "Dansk", "no": "Norsk", "fa": "فارسی",
};

export const getLocaleInfo = (locale: string) => ({ name: LOCALE_NAMES[locale] || locale, code: locale.split("-")[0].toUpperCase() });

interface LanguageGridProps {
  locale: string; isPending: boolean; onSelect: (locale: string) => void;
}

export function LanguageGrid({ locale, isPending, onSelect }: LanguageGridProps) {
  return (
    <div className="p-6 overflow-y-auto flex-1">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2">
        {LOCALES.map((item) => {
          const active = locale === item;
          const info = getLocaleInfo(item);
          return (
            <Button key={item} variant={active ? "default" : "ghost"} onClick={() => onSelect(item)} disabled={isPending}
              className={`relative flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-lg px-2 py-3 text-xs font-medium ${active ? "bg-primary/15 text-primary ring-2 ring-primary" : "text-text-main hover:bg-surface-2/50"} ${isPending ? "opacity-70 cursor-wait" : ""}`} title={info.name}>
              {active && <Check className="absolute right-1.5 top-1.5 size-3.5" />}
              <span className="rounded bg-surface-2/70 px-1.5 py-0.5 text-[10px] font-bold tracking-wide">{info.code}</span>
              <span className="flex h-8 items-center text-center leading-tight line-clamp-2">{info.name}</span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";
import { translate } from "@/i18n/runtime";
import { getLocaleName } from "@/shared/constants/locales";
import LanguageSwitcher from "./LanguageSwitcher";
import LocaleFlag from "./LocaleFlag";

function getLocaleFromCookie(): string {
  if (typeof document === "undefined") return "en";
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : "en";
  return normalizeLocale(value);
}

export default function HeaderLanguage() {
  const [open, setOpen] = useState(false);
  const locale = useSyncExternalStore(
    () => () => {},
    getLocaleFromCookie,
    () => "en",
  );

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          setOpen(true);
        }}
        className="flex items-center justify-center rounded-lg p-2 text-text-muted hover:bg-surface-2/50 hover:text-text-main"
        title={`${translate("Language")}: ${getLocaleName(locale)}`}
        aria-label={`${translate("Language")}: ${getLocaleName(locale)}`}
        data-i18n-skip="true"
      >
        <LocaleFlag locale={locale} className="h-[15px] w-[22px]" />
      </Button>

      <LanguageSwitcher
        hideTrigger
        isOpen={open}
        onClose={() => {
          setOpen(false);
        }}
      />
    </>
  );
}

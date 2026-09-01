"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";
import { reloadTranslations, translate } from "@/i18n/runtime";
import { Globe } from "lucide-react";
import { LanguageGrid, getLocaleInfo } from "./LanguageGrid";

function getLocaleFromCookie(): string {
  if (typeof document === "undefined") return "en";
  const cookie = document.cookie.split(";").find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  return normalizeLocale(cookie ? decodeURIComponent(cookie.split("=")[1]) : "en");
}

interface LanguageSwitcherProps { className?: string; isOpen?: boolean; onClose?: (locale?: string) => void; hideTrigger?: boolean; }

export default function LanguageSwitcher({ className = "", isOpen: controlledOpen, onClose, hideTrigger = false }: LanguageSwitcherProps) {
  const cookieLocale = useSyncExternalStore(() => () => {}, getLocaleFromCookie, () => "en");
  const [selectedLocale, setSelectedLocale] = useState<string | null>(null);
  const locale = selectedLocale ?? cookieLocale;
  const [isPending, setIsPending] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = typeof controlledOpen === "boolean";
  const isOpen = isControlled ? controlledOpen : internalOpen;

  const handleSetLocale = async (nextLocale: string) => {
    if (nextLocale === locale || isPending) return;
    setIsPending(true);
    try {
      await fetch("/api/locale", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale: nextLocale }) });
      await reloadTranslations(); setSelectedLocale(nextLocale);
      if (isControlled) onClose?.(nextLocale); else setInternalOpen(false);
    } catch (e) { console.error("Failed to set locale:", e);
    } finally { setIsPending(false); }
  };

  return (
    <div className={className}>
      {!hideTrigger && (
        <Button variant="ghost" onClick={() => { if (isControlled) { if (isOpen) onClose?.(locale); } else setInternalOpen((p) => !p); }} disabled={isPending}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-text-muted hover:text-text-main hover:bg-surface/60" title="Idioma" data-i18n-skip="true">
          <Globe className="size-5" /><span className="text-sm font-medium">{getLocaleInfo(locale).name}</span>
        </Button>
      )}
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) { if (isControlled) onClose?.(locale); else setInternalOpen(false); } }}>
        <DialogContent className="p-0 gap-0 overflow-hidden sm:max-w-2xl max-h-[80vh] flex flex-col" data-i18n-skip="true">
          <DialogTitle className="sr-only">{translate("Select Language")}</DialogTitle>
          <div className="flex items-center justify-between p-3 border-b border-black/5 dark:border-white/5"><h2 className="text-lg font-semibold text-text-main">{translate("Select Language")}</h2></div>
          <LanguageGrid locale={locale} isPending={isPending} onSelect={handleSetLocale} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

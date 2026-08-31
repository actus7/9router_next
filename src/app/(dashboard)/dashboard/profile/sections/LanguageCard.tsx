"use client";

import { Card, Button } from "@/shared/components";
import { Globe } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { LOCALE_FLAGS } from "@/shared/constants/locales";

interface LanguageCardProps {
  locale: string;
  setLangOpen: (open: boolean) => void;
}

export default function LanguageCard({ locale, setLangOpen }: LanguageCardProps) {
  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="size-10 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0">
          <Globe className="size-5" />
        </div>
        <h3 className="text-base sm:text-lg font-semibold">{translate("Language")}</h3>
      </div>
      <Button
        variant="outline"
        onClick={() => setLangOpen(true)}
        className="flex items-center justify-between w-full p-3 rounded-lg bg-bg border border-border hover:border-primary/50 transition-colors"
        data-i18n-skip="true"
      >
        <span className="text-sm text-text-muted">{translate("Display language")}</span>
        <span className="text-2xl">{(LOCALE_FLAGS as Record<string, string>)[locale] || "🌐"}</span>
      </Button>
    </Card>
  );
}

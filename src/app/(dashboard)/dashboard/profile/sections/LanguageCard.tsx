"use client";

import { Card } from "@/shared/components";
import { Button } from "@/components/ui/button";
import { Globe } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { getLocaleName } from "@/shared/constants/locales";
import LocaleFlag from "@/shared/components/LocaleFlag";

interface LanguageCardProps {
  locale: string;
  setLangOpen: (open: boolean) => void;
}

export default function LanguageCard({ locale, setLangOpen }: LanguageCardProps) {
  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="size-10 rounded-lg bg-info text-info-foreground flex items-center justify-center shrink-0">
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
        <span className="flex items-center gap-2 text-sm font-medium text-text-main">
          <LocaleFlag locale={locale} />
          {getLocaleName(locale)}
        </span>
      </Button>
    </Card>
  );
}

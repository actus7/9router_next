"use client";

import { useMemo, useState } from "react";
import { LOCALES } from "@/i18n/config";
import { translate } from "@/i18n/runtime";
import {
  LOCALE_NAMES,
  LOCALE_SEARCH_ALIASES,
  getLocaleName,
} from "@/shared/constants/locales";
import { Check, Search } from "lucide-react";
import LocaleFlag from "./LocaleFlag";

// "Português" typed without the accent should still match.
const fold = (value: string) =>
  value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

interface LanguageListProps {
  locale: string;
  isPending: boolean;
  onSelect: (locale: string) => void;
}

export function LanguageList({ locale, isPending, onSelect }: LanguageListProps) {
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const needle = fold(query.trim());
    if (!needle) return LOCALES as readonly string[];
    return (LOCALES as readonly string[]).filter((item) =>
      fold(`${item} ${LOCALE_NAMES[item] ?? ""} ${LOCALE_SEARCH_ALIASES[item] ?? ""}`).includes(
        needle,
      ),
    );
  }, [query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative border-b border-border px-4 py-3">
        <Search className="pointer-events-none absolute left-7 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={translate("Search language") ?? "Search language"}
          aria-label={translate("Search language") ?? "Search language"}
          autoFocus
          className="w-full rounded-lg bg-surface-2/60 py-2 pl-9 pr-3 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {matches.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-text-muted">
            {translate("No language matches this search.")}
          </p>
        ) : (
          <ul className="grid gap-0.5 sm:grid-cols-2">
            {matches.map((item) => {
              const active = locale === item;
              return (
                <li key={item}>
                  <button
                    type="button"
                    onClick={() => onSelect(item)}
                    disabled={isPending}
                    aria-current={active ? "true" : undefined}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      active
                        ? "bg-primary/12 font-medium text-primary"
                        : "text-text-main hover:bg-surface-2/60"
                    } ${isPending ? "cursor-wait opacity-60" : ""}`}
                  >
                    <LocaleFlag locale={item} />
                    <span className="min-w-0 flex-1 truncate">{getLocaleName(item)}</span>
                    {active ? (
                      <Check className="size-4 shrink-0" />
                    ) : (
                      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-text-muted">
                        {item}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

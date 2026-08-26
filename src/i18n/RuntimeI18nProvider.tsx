"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { initRuntimeI18n, reloadTranslations, setServerTranslations } from "./runtime";
import type { Locale } from "./config";

interface RuntimeI18nProviderProps {
  children: ReactNode;
  /** Server-provided locale (read from cookie on the server) */
  locale?: Locale;
  /** Server-provided translations (loaded from disk on the server) */
  translations?: Record<string, string>;
}

export function RuntimeI18nProvider({
  children,
  locale,
  translations,
}: RuntimeI18nProviderProps): React.JSX.Element {
  const pathname: string | null = usePathname();

  // Initialize with server-provided translations (synchronous, no hydration mismatch)
  useEffect(() => {
    if (locale && translations) {
      setServerTranslations(locale, translations);
    } else {
      initRuntimeI18n();
    }
  }, [locale, translations]);

  // Re-process DOM when route changes
  useEffect(() => {
    if (pathname) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          reloadTranslations();
        });
      });
    }
  }, [pathname]);

  return <>{children}</>;
}

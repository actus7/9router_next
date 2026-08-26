"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { initRuntimeI18n, reloadTranslations, applyServerTranslations } from "./runtime";
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
  const initialized = useRef(false);

  // Apply translations SYNCHRONOUSLY before children render.
  // This ensures server and client render the same text on first paint.
  if (locale && translations && !initialized.current) {
    applyServerTranslations(locale, translations);
    initialized.current = true;
  }

  // Set up DOM observer for future translations (runs once after mount)
  useEffect(() => {
    if (!locale || !translations) {
      // Fallback: no server props, load translations async
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

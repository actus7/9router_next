"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { initRuntimeI18n, reloadTranslations } from "./runtime";
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
  const isInitialPathname = useRef(true);

  // Client components are pre-rendered on the server, where the runtime
  // translation singleton starts in English. Applying a locale here (before
  // hydration) makes the client render differ from that server HTML. Start
  // translation only after hydration, then keep the DOM observer active.
  useEffect(() => {
    void initRuntimeI18n();
  }, [locale, translations]);

  // Re-process DOM when route changes (skip initial render to preserve SSR translations)
  useEffect(() => {
    if (isInitialPathname.current) {
      isInitialPathname.current = false;
      return;
    }
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

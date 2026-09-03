"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { initRuntimeI18n, reloadTranslations, seedRuntimeI18n } from "./runtime";
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

  if (locale) {
    seedRuntimeI18n(locale, translations ?? {});
  }

  // `initRuntimeI18n` mutates text nodes to translate the already rendered
  // document. A parent effect can run while streamed client boundaries are
  // still hydrating, which lets that mutation race React and produces a
  // hydration mismatch (for example, "Select model" -> "Selecionar modelo").
  // Wait for two frames so the initial server HTML is fully claimed first.
  useEffect(() => {
    let secondFrame: number | undefined;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        void initRuntimeI18n();
      });
    });

    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame !== undefined) cancelAnimationFrame(secondFrame);
    };
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

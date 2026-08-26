/**
 * Server-side i18n utilities.
 *
 * Reads the locale cookie and loads translations on the server,
 * ensuring server and client render the same translated text.
 * This module is server-only — do NOT add a 'use client' directive.
 */

import { cookies } from "next/headers";
import { readFile } from "fs/promises";
import { join } from "path";
import { normalizeLocale, DEFAULT_LOCALE, LOCALE_COOKIE } from "./config";
import type { Locale } from "./config";

type TranslationMap = Record<string, string>;

// Cache translations in memory to avoid reading from disk on every request
const cache = new Map<Locale, TranslationMap>();

/**
 * Read the locale from the cookie header (server-side).
 */
async function getLocaleFromCookies(): Promise<Locale> {
  try {
    const cookieStore = await cookies();
    const localeCookie = cookieStore.get(LOCALE_COOKIE)?.value;
    if (!localeCookie) return DEFAULT_LOCALE;
    return normalizeLocale(localeCookie);
  } catch {
    return DEFAULT_LOCALE;
  }
}

/**
 * Load translations for a locale from the JSON files on disk.
 * Returns an empty map for English (no translations needed).
 */
async function getTranslations(locale: Locale): Promise<TranslationMap> {
  if (locale === "en") return {};

  // Check cache first
  if (cache.has(locale)) return cache.get(locale)!;

  try {
    const filePath = join(process.cwd(), "public", "i18n", "literals", `${locale}.json`);
    const content = await readFile(filePath, "utf-8");
    const translations: TranslationMap = JSON.parse(content);
    cache.set(locale, translations);
    return translations;
  } catch {
    // File not found or parse error — return empty map
    return {};
  }
}

/**
 * Convenience: get locale + translations in one call.
 */
export async function getI18nProps(): Promise<{
  locale: Locale;
  translations: TranslationMap;
}> {
  const locale = await getLocaleFromCookies();
  const translations = await getTranslations(locale);
  return { locale, translations };
}

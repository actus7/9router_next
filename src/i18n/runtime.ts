"use client";

import { DEFAULT_LOCALE, LOCALE_COOKIE, normalizeLocale } from "./config";
import type { Locale } from "./config";

// ─── Types ───────────────────────────────────────────────────────────────────

type TranslationMap = Record<string, string>;
type ReloadCallback = () => void;

interface TranslatedText extends Text {
  _originalText?: string;
  _translatedText?: string;
}

// ─── State ───────────────────────────────────────────────────────────────────

// Check for server-injected translations (set via <script> tag before React hydrates)
const g =
  typeof globalThis !== "undefined"
    ? (globalThis as Record<string, unknown>)
    : {};
const serverLocale = g.__I18N_LOCALE__ as Locale | undefined;
const serverTranslations = g.__I18N_TRANSLATIONS__ as
  TranslationMap | undefined;

let translationMap: TranslationMap = serverTranslations || {};
let currentLocale: Locale = serverLocale || DEFAULT_LOCALE;
let reloadCallbacks: ReloadCallback[] = [];

// Read locale from cookie
function getLocaleFromCookie(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const cookie: string | undefined = document.cookie
    .split(";")
    .find((c: string) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value: string = cookie
    ? decodeURIComponent(cookie.split("=")[1])
    : DEFAULT_LOCALE;
  return normalizeLocale(value);
}

// Load translation map
async function loadTranslations(locale: Locale): Promise<void> {
  if (locale === "en") {
    translationMap = {};
    return;
  }

  try {
    const response: Response = await fetch(`/i18n/literals/${locale}.json`);
    translationMap = await response.json();
  } catch (err: unknown) {
    console.error("Failed to load translations:", err);
    translationMap = {};
  }
}

// Translate text - exported for use in components
export function translate(
  text: string | null | undefined,
): string | null | undefined {
  if (!text || typeof text !== "string") return text;
  const trimmed: string = text.trim();
  if (!trimmed) return text;
  if (currentLocale === "en") return text;
  return translationMap[trimmed] || text;
}

// Get current locale - exported for use in components
export function getCurrentLocale(): Locale {
  return currentLocale;
}

// Register callback for locale changes
export function onLocaleChange(callback: ReloadCallback): () => void {
  reloadCallbacks.push(callback);
  return () => {
    reloadCallbacks = reloadCallbacks.filter(
      (cb: ReloadCallback) => cb !== callback,
    );
  };
}

// Process text node
function processTextNode(node: Text): void {
  if (!node.nodeValue || !node.nodeValue.trim()) return;

  // Skip if parent is script, style, code, or structural elements
  const parent: HTMLElement | null = node.parentElement;
  if (!parent) return;

  // Skip if parent or any ancestor has data-i18n-skip attribute
  let element: HTMLElement | null = parent;
  while (element) {
    if (element.hasAttribute && element.hasAttribute("data-i18n-skip")) {
      return;
    }
    element = element.parentElement;
  }

  const tagName: string | undefined = parent.tagName?.toLowerCase();

  // Skip elements that don't allow text nodes
  const skipTags: string[] = [
    "script",
    "style",
    "code",
    "pre",
    "colgroup",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "select",
    "datalist",
    "optgroup",
  ];

  if (skipTags.includes(tagName!)) return;

  // React may reuse a Text node while replacing its content during client-side
  // navigation. If that happens, discard the prior source text: otherwise a
  // page title such as "Providers" can be rewritten with the previous route's
  // translated title (for example, "Chat").
  const translatedNode = node as TranslatedText;
  if (
    !translatedNode._originalText ||
    (translatedNode._translatedText !== undefined &&
      node.nodeValue !== translatedNode._translatedText)
  ) {
    translatedNode._originalText = node.nodeValue;
  }

  // Use original text for translation
  const original: string = translatedNode._originalText!;
  const translated: string | null | undefined = translate(original);

  // Only update if different to avoid unnecessary DOM mutations
  if (translated != null && translated !== node.nodeValue) {
    node.nodeValue = translated;
  }
  translatedNode._translatedText = translated ?? original;
}

// Process all text nodes in element
function processElement(element: Node): void {
  if (!element) return;

  const walker: TreeWalker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null,
  );

  let node: Text | null;
  const nodesToProcess: Text[] = [];

  // Collect all nodes first to avoid live collection issues
  while ((node = walker.nextNode() as Text | null)) {
    nodesToProcess.push(node);
  }

  // Process collected nodes
  nodesToProcess.forEach(processTextNode);
}

// Apply server-provided translations synchronously (before render).
// This sets the module-level variables so translate() returns correct text
// during the initial client render, preventing hydration mismatches.
export function seedRuntimeI18n(
  locale: Locale,
  translations: TranslationMap = {},
): void {
  currentLocale = locale;
  translationMap = translations;
  if (typeof globalThis !== "undefined") {
    (globalThis as Record<string, unknown>).__I18N_LOCALE__ = locale;
    (globalThis as Record<string, unknown>).__I18N_TRANSLATIONS__ = translations;
  }
}

// Initialize runtime i18n (fallback when server props not available)
export async function initRuntimeI18n(): Promise<void> {
  if (typeof window === "undefined") return;

  const cookieLocale = getLocaleFromCookie();
  const hasSeededTranslations =
    cookieLocale === currentLocale &&
    (currentLocale === "en" || Object.keys(translationMap).length > 0);

  if (!hasSeededTranslations) {
    currentLocale = cookieLocale;
    await loadTranslations(currentLocale);
  }

  // Process existing DOM
  processElement(document.body);

  // Watch for new nodes
  const observer: MutationObserver = new MutationObserver(
    (mutations: MutationRecord[]) => {
      mutations.forEach((mutation: MutationRecord) => {
        mutation.addedNodes.forEach((node: Node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            processElement(node);
          } else if (node.nodeType === Node.TEXT_NODE) {
            processTextNode(node as Text);
          }
        });
      });
    },
  );

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Reload translations when locale changes
export async function reloadTranslations(): Promise<void> {
  currentLocale = getLocaleFromCookie();
  await loadTranslations(currentLocale);

  // Notify all registered callbacks
  reloadCallbacks.forEach((callback: ReloadCallback) => callback());

  // Re-process entire DOM (will use stored original text)
  processElement(document.body);
}
